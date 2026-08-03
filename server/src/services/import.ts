import {
  parseDlsiteProductJson,
  dlsiteProductJsonUrl,
  parseDlsiteSalesPayload,
  mergeProductInfo,
  maxSalesCursor,
  type DlsiteSaleEntry,
} from "@adp/shared/adapters/dlsite";
import type { DatabaseSync } from "node:sqlite";
import { recomputeMatchKeys } from "./lookup.js";

export type ProductFetcher = (workno: string) => Promise<unknown | null>;

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

export async function importDlsitePayload(
  db: DatabaseSync,
  raw: unknown,
  fetchProduct: ProductFetcher = defaultProductFetcher,
): Promise<ImportCounts> {
  const sales = parseDlsiteSalesPayload(raw);
  let inserted = 0;
  let updated = 0;
  const now = new Date().toISOString();

  for (const sale of sales) {
    const productRaw = await fetchProduct(sale.workno);
    const product = productRaw ? parseDlsiteProductJson(productRaw) : null;
    const parsed = mergeProductInfo(sale, product);
    const existing = db
      .prepare("SELECT id FROM listing WHERE source = 'dlsite' AND cid = ?")
      .get(parsed.cid) as { id: number } | undefined;

    if (existing) {
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
      updated++;
    } else {
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
      inserted++;
    }
  }

  const cursor = maxSalesCursor(sales);
  if (cursor) {
    db.prepare(
      `INSERT INTO sync_state (source, cursor, last_synced_at) VALUES ('dlsite', ?, ?)
       ON CONFLICT(source) DO UPDATE SET cursor = excluded.cursor, last_synced_at = excluded.last_synced_at`,
    ).run(cursor, now);
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
    const product = productRaw ? parseDlsiteProductJson(productRaw) : null;
    const parsed = mergeProductInfo(sale, product);
    const existing = db
      .prepare("SELECT id FROM listing WHERE source = 'dlsite' AND cid = ?")
      .get(parsed.cid) as { id: number } | undefined;

    if (existing) {
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
      updated++;
    } else {
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
      inserted++;
    }
  }

  const cursor = maxSalesCursor(sales);
  if (cursor) {
    db.prepare(
      `INSERT INTO sync_state (source, cursor, last_synced_at) VALUES ('dlsite', ?, ?)
       ON CONFLICT(source) DO UPDATE SET cursor = excluded.cursor, last_synced_at = excluded.last_synced_at`,
    ).run(cursor, now);
  }

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
