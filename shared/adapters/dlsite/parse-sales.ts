import { z } from "zod";
import type { DlsiteParsedListing, DlsiteSaleEntry } from "./types.js";
import { isValidDlsiteWorkno } from "./urls.js";

/** Normalize DLsite workno (trim + uppercase). */
function normalizeDlsiteCid(workno: string): string {
  return workno.trim().toUpperCase();
}

const DlsiteSaleEntrySchema = z.object({
  workno: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, { message: "workno required" })
    .refine((s) => isValidDlsiteWorkno(s), { message: "invalid workno" }),
  sales_date: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, { message: "sales_date required" })
    .refine((s) => Number.isFinite(Date.parse(s)), { message: "invalid sales_date" }),
});

const DlsiteSalesArraySchema = z.array(DlsiteSaleEntrySchema).min(1);

/**
 * Parse raw extension payload from DLsite sales API.
 * Accepts a non-empty array of sale entries or `{ items: [...] }`.
 * Invalid entries reject the entire batch (no silent drop).
 */
export function parseDlsiteSalesPayload(raw: unknown): DlsiteSaleEntry[] {
  let entries: unknown;
  if (Array.isArray(raw)) {
    entries = raw;
  } else if (
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as { items?: unknown }).items)
  ) {
    entries = (raw as { items: unknown[] }).items;
  } else {
    throw new Error("DLsite sales payload must be a non-empty array");
  }

  const parsed = DlsiteSalesArraySchema.safeParse(entries);
  if (!parsed.success) {
    throw new Error("DLsite sales payload failed schema validation");
  }
  return parsed.data.map((e) => ({
    workno: e.workno,
    sales_date: e.sales_date,
  }));
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
