import {
  parseDlsiteProductJson,
  dlsiteProductJsonUrl,
  parseDlsiteSalesPayload,
  mergeProductInfo,
  maxSalesCursor,
  isStrictUtcIsoInstant,
  type DlsiteSaleEntry,
  type DlsiteProductInfo,
} from "@adp/shared/adapters/dlsite";
import type { DatabaseSync } from "node:sqlite";
import { recomputeMatchKeys } from "./lookup.js";

export type ProductFetcher = (workno: string) => Promise<unknown | null>;

/** Bound concurrent product.json fetches so first-sync stays within worker lifetime. */
export const PRODUCT_FETCH_CONCURRENCY = 6;

export interface ImportOptions {
  /**
   * When true (default), advance sync_state.cursor to this batch's max sales_date
   * after all rows upsert. Multi-chunk syncs set false and commit the global max once.
   */
  advanceCursor?: boolean;
}

const defaultProductFetcher: ProductFetcher = async (workno) => {
  try {
    const res = await fetch(dlsiteProductJsonUrl(workno), {
      headers: { "User-Agent": "Mozilla/5.0 (ADP)" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
};

export interface ImportCounts {
  inserted: number;
  updated: number;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i]!, i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function productForSale(
  sale: DlsiteSaleEntry,
  productRaw: unknown | null,
): DlsiteProductInfo | null {
  if (!productRaw) return null;
  const product = parseDlsiteProductJson(productRaw);
  if (!product) return null;
  // Exact workno equality: never merge another CID's product.json into this sale.
  if (product.workno !== sale.workno.trim().toUpperCase()) return null;
  return product;
}

function saleEvidence(sale: DlsiteSaleEntry): Record<string, unknown> {
  if (sale.raw && typeof sale.raw === "object") return sale.raw;
  return { workno: sale.workno, sales_date: sale.sales_date };
}

/**
 * Re-import without valid product enrichment: preserve display metadata, match keys,
 * and prior product raw evidence. Only sale cursor fields (purchased_at) and sale
 * evidence inside raw_json are refreshed.
 */
function updateExistingWithoutProduct(
  db: DatabaseSync,
  listingId: number,
  sale: DlsiteSaleEntry,
  now: string,
): void {
  const prev = db
    .prepare("SELECT raw_json FROM listing WHERE id = ?")
    .get(listingId) as { raw_json: string } | undefined;

  let nextRawJson = prev?.raw_json ?? JSON.stringify({ sale: saleEvidence(sale) });
  try {
    const parsed = prev?.raw_json ? JSON.parse(prev.raw_json) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      obj.sale = saleEvidence(sale);
      // Keep prior product evidence when present (including unknown fields).
      nextRawJson = JSON.stringify(obj);
    }
  } catch {
    // Leave prior raw_json bytes untouched if unparseable.
  }

  db.prepare(
    `UPDATE listing SET
      purchased_at = ?, purchased_at_precision = ?, raw_json = ?, imported_at = ?
     WHERE id = ?`,
  ).run(sale.sales_date, "second", nextRawJson, now, listingId);
  // Intentionally do not recompute match keys — title/maker unchanged.
}

function upsertListing(
  db: DatabaseSync,
  sale: DlsiteSaleEntry,
  productRaw: unknown | null,
  now: string,
): "inserted" | "updated" {
  const product = productForSale(sale, productRaw);
  const cid = sale.workno.trim().toUpperCase();
  const existing = db
    .prepare("SELECT id FROM listing WHERE source = 'dlsite' AND cid = ?")
    .get(cid) as { id: number } | undefined;

  if (existing) {
    if (!product) {
      // Unavailable / HTTP-failed / malformed / CID-mismatched enrichment.
      updateExistingWithoutProduct(db, existing.id, sale, now);
      return "updated";
    }

    const parsed = mergeProductInfo(sale, product);
    db.prepare(
      `UPDATE listing SET
        title = ?, maker_name = ?, series_id = ?, image_url = ?,
        purchased_at = ?, purchased_at_precision = ?, raw_json = ?, imported_at = ?
       WHERE id = ?`,
    ).run(
      parsed.title,
      parsed.maker,
      parsed.seriesId,
      parsed.imageUrl,
      parsed.purchasedAt,
      parsed.purchasedAtPrecision,
      parsed.rawJson,
      now,
      existing.id,
    );
    recomputeMatchKeys(db, existing.id);
    return "updated";
  }

  const parsed = mergeProductInfo(sale, product);
  db.prepare("INSERT INTO work DEFAULT VALUES").run();
  const workId = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id);
  db.prepare(
    `INSERT INTO listing (
      source, cid, work_id, title, maker_name, series_id, image_url,
      purchased_at, purchased_at_precision, raw_json, imported_at
    ) VALUES ('dlsite', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    parsed.cid,
    workId,
    parsed.title,
    parsed.maker,
    parsed.seriesId,
    parsed.imageUrl,
    parsed.purchasedAt,
    parsed.purchasedAtPrecision,
    parsed.rawJson,
    now,
  );
  const listingId = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id);
  recomputeMatchKeys(db, listingId);
  return "inserted";
}

function writeCursor(db: DatabaseSync, cursor: string, now: string): void {
  db.prepare(
    `INSERT INTO sync_state (source, cursor, last_synced_at) VALUES ('dlsite', ?, ?)
     ON CONFLICT(source) DO UPDATE SET cursor = excluded.cursor, last_synced_at = excluded.last_synced_at`,
  ).run(cursor, now);
}

function advanceCursor(db: DatabaseSync, sales: DlsiteSaleEntry[], now: string): void {
  const cursor = maxSalesCursor(sales);
  if (!cursor) return;
  writeCursor(db, cursor, now);
}

/**
 * Persist DLsite `last=` cursor after a complete multi-chunk sync succeeds.
 * Rejects non-strict UTC ISO instants so cursor storage stays comparable.
 */
export function commitDlsiteCursor(db: DatabaseSync, cursor: string, now = new Date().toISOString()): void {
  const trimmed = cursor.trim();
  if (!isStrictUtcIsoInstant(trimmed)) {
    throw new Error("invalid cursor");
  }
  writeCursor(db, trimmed, now);
}

/**
 * Import a DLsite sales batch.
 * Product metadata is fetched with bounded concurrency (deferred relative to parse,
 * not sequential per-row). Cursor advances only after the full batch upserts succeed
 * when `advanceCursor` is true (default). Multi-chunk syncs disable per-chunk advance
 * and call {@link commitDlsiteCursor} once with the global max.
 */
export async function importDlsitePayload(
  db: DatabaseSync,
  raw: unknown,
  fetchProduct: ProductFetcher = defaultProductFetcher,
  concurrency: number = PRODUCT_FETCH_CONCURRENCY,
  options: ImportOptions = {},
): Promise<ImportCounts> {
  const advance = options.advanceCursor !== false;
  const sales = parseDlsiteSalesPayload(raw);
  const now = new Date().toISOString();

  // Bound enrichment: fetch product.json for the batch with limited concurrency.
  const products = await mapWithConcurrency(sales, concurrency, async (sale) => {
    try {
      return await fetchProduct(sale.workno);
    } catch {
      return null;
    }
  });

  let inserted = 0;
  let updated = 0;
  for (let i = 0; i < sales.length; i++) {
    const result = upsertListing(db, sales[i]!, products[i] ?? null, now);
    if (result === "inserted") inserted++;
    else updated++;
  }

  // Atomic cursor handling: advance only after all rows in this batch are written,
  // and only when the caller wants this batch to own the cursor commit.
  if (advance) {
    advanceCursor(db, sales, now);
  }

  return { inserted, updated };
}

export function seedDlsiteFromSales(
  db: DatabaseSync,
  sales: DlsiteSaleEntry[],
  productByWorkno: Record<string, unknown> = {},
): ImportCounts {
  let inserted = 0;
  let updated = 0;
  const now = new Date().toISOString();

  for (const sale of sales) {
    const productRaw = productByWorkno[sale.workno.toUpperCase()] ?? productByWorkno[sale.workno];
    const result = upsertListing(db, sale, productRaw ?? null, now);
    if (result === "inserted") inserted++;
    else updated++;
  }

  advanceCursor(db, sales, now);
  return { inserted, updated };
}

export function getSyncState(
  db: DatabaseSync,
  source: string,
): { cursor: string | null; lastSyncedAt: string | null } {
  const row = db
    .prepare("SELECT cursor, last_synced_at FROM sync_state WHERE source = ?")
    .get(source) as { cursor: string | null; last_synced_at: string } | undefined;
  if (!row) return { cursor: null, lastSyncedAt: null };
  return { cursor: row.cursor, lastSyncedAt: row.last_synced_at };
}
