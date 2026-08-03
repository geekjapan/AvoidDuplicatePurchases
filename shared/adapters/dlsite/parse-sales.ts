import type { DlsiteParsedListing, DlsiteSaleEntry } from "./types.js";
import { isValidDlsiteWorkno } from "./urls.js";

/** Normalize DLsite workno (trim + uppercase). */
function normalizeDlsiteCid(workno: string): string {
  return workno.trim().toUpperCase();
}

function parseSaleEntry(entry: unknown): DlsiteSaleEntry | null {
  if (!entry || typeof entry !== "object") return null;
  const rec = entry as Record<string, unknown>;
  const workno = typeof rec.workno === "string" ? rec.workno.trim() : "";
  const salesDate = typeof rec.sales_date === "string" ? rec.sales_date.trim() : "";
  if (!workno || !salesDate) return null;
  if (!isValidDlsiteWorkno(workno)) return null;
  return { workno, sales_date: salesDate };
}

/**
 * Parse raw extension payload from DLsite sales API.
 * Accepts a non-empty array of sale entries or `{ items: [...] }`.
 */
export function parseDlsiteSalesPayload(raw: unknown): DlsiteSaleEntry[] {
  let entries: unknown[] | null = null;
  if (Array.isArray(raw)) {
    entries = raw;
  } else if (
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as { items?: unknown }).items)
  ) {
    entries = (raw as { items: unknown[] }).items;
  }
  if (!entries || entries.length === 0) {
    throw new Error("DLsite sales payload must be a non-empty array");
  }
  const parsed = entries.map(parseSaleEntry).filter((e): e is DlsiteSaleEntry => e !== null);
  if (parsed.length === 0) {
    throw new Error("DLsite sales payload contained no valid entries");
  }
  return parsed;
}

/** Build a listing stub from sales history alone (product.json unavailable). */
export function listingFromSale(entry: DlsiteSaleEntry): DlsiteParsedListing {
  const cid = normalizeDlsiteCid(entry.workno);
  return {
    cid,
    title: cid,
    maker: null,
    seriesId: null,
    imageUrl: null,
    purchasedAt: entry.sales_date,
    purchasedAtPrecision: "second",
    rawJson: JSON.stringify(entry),
  };
}

/** Merge product.json metadata into a sales-derived listing. */
export function mergeProductInfo(
  sale: DlsiteSaleEntry,
  product: {
    work_name?: string;
    maker_name?: string | null;
    series_id?: string | null;
    image_url?: string | null;
  } | null,
): DlsiteParsedListing {
  const base = listingFromSale(sale);
  if (!product) return base;
  const title =
    typeof product.work_name === "string" && product.work_name.trim()
      ? product.work_name.trim()
      : base.title;
  return {
    ...base,
    title,
    maker:
      typeof product.maker_name === "string" && product.maker_name.trim()
        ? product.maker_name.trim()
        : null,
    seriesId:
      typeof product.series_id === "string" && product.series_id.trim()
        ? product.series_id.trim()
        : null,
    imageUrl:
      typeof product.image_url === "string" && product.image_url.trim()
        ? product.image_url.trim()
        : null,
    rawJson: JSON.stringify({ sale, product }),
  };
}

/** Compute the `last=` cursor from the newest sales_date in a batch. */
export function maxSalesCursor(entries: DlsiteSaleEntry[]): string | null {
  if (entries.length === 0) return null;
  let max = entries[0]!.sales_date;
  for (const e of entries) {
    if (e.sales_date > max) max = e.sales_date;
  }
  return max;
}
