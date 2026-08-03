import { z } from "zod";
import type { DlsiteParsedListing, DlsiteSaleEntry } from "./types.js";
import { isValidDlsiteWorkno } from "./urls.js";

/** Normalize DLsite workno (trim + uppercase). */
function normalizeDlsiteCid(workno: string): string {
  return workno.trim().toUpperCase();
}

/**
 * Strict UTC ISO-8601 instant: `YYYY-MM-DDTHH:mm:ss[.fraction]Z` only.
 * Rejects locale dates, offset timezones, and impossible calendar days (e.g. Feb 30).
 */
export function isStrictUtcIsoInstant(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z$/.exec(value);
  if (!m) return false;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6]);

  if (month < 1 || month > 12) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;

  // Round-trip through UTC components so 2024-02-30 / 2024-04-31 are rejected.
  const dt = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day &&
    dt.getUTCHours() === hour &&
    dt.getUTCMinutes() === minute &&
    dt.getUTCSeconds() === second
  );
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
    .refine((s) => isStrictUtcIsoInstant(s), { message: "invalid sales_date" }),
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
  // Keep validated derived fields while retaining each original sales row untouched.
  return parsed.data.map((e, i) => {
    const original = (entries as unknown[])[i];
    const raw =
      original && typeof original === "object" && !Array.isArray(original)
        ? { ...(original as Record<string, unknown>) }
        : { workno: e.workno, sales_date: e.sales_date };
    return {
      workno: e.workno,
      sales_date: e.sales_date,
      raw,
    };
  });
}

function saleEvidence(entry: DlsiteSaleEntry): Record<string, unknown> {
  if (entry.raw && typeof entry.raw === "object") return entry.raw;
  return { workno: entry.workno, sales_date: entry.sales_date };
}

function productEvidence(product: {
  workno?: string;
  work_name?: string;
  maker_name?: string | null;
  series_id?: string | null;
  image_url?: string | null;
  raw?: Record<string, unknown>;
}): Record<string, unknown> {
  if (product.raw && typeof product.raw === "object") return product.raw;
  return {
    workno: product.workno,
    work_name: product.work_name,
    maker_name: product.maker_name,
    series_id: product.series_id,
    image_url: product.image_url,
  };
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
    rawJson: JSON.stringify({ sale: saleEvidence(entry) }),
  };
}

/** Merge product.json metadata into a sales-derived listing. */
export function mergeProductInfo(
  sale: DlsiteSaleEntry,
  product: {
    workno?: string;
    work_name?: string;
    maker_name?: string | null;
    series_id?: string | null;
    image_url?: string | null;
    raw?: Record<string, unknown>;
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
    // Complete untouched sale + product evidence (unknown fields retained via .raw).
    rawJson: JSON.stringify({
      sale: saleEvidence(sale),
      product: productEvidence(product),
    }),
  };
}

/**
 * Split an already-validated strict UTC ISO instant into second base + fraction digits.
 * Seconds-only forms (no `.`) use empty fraction (equivalent to all zeros).
 */
function splitUtcIsoInstant(salesDate: string): { base: string; fraction: string } {
  // Validated shape: YYYY-MM-DDTHH:mm:ss[.fraction]Z
  const body = salesDate.endsWith("Z") ? salesDate.slice(0, -1) : salesDate;
  const dot = body.indexOf(".");
  if (dot === -1) {
    return { base: body, fraction: "" };
  }
  return { base: body.slice(0, dot), fraction: body.slice(dot + 1) };
}

/**
 * Exact chronological compare for validated UTC ISO instants without Date/Number precision loss.
 * - Lexical compare of fixed-width second base (YYYY-MM-DDTHH:mm:ss)
 * - Fraction digits compared after right-padding the shorter with zeros
 * - Raw-string tie-break for equal instants (e.g. .1Z vs .100Z) so result is order-independent
 * Returns negative if a < b, positive if a > b, zero if equal after tie-break.
 */
export function compareUtcIsoInstants(a: string, b: string): number {
  if (a === b) return 0;
  const pa = splitUtcIsoInstant(a);
  const pb = splitUtcIsoInstant(b);
  if (pa.base < pb.base) return -1;
  if (pa.base > pb.base) return 1;
  const width = Math.max(pa.fraction.length, pb.fraction.length);
  const fa = pa.fraction.padEnd(width, "0");
  const fb = pb.fraction.padEnd(width, "0");
  if (fa < fb) return -1;
  if (fa > fb) return 1;
  // Mathematically equal instants: deterministic raw-string preference (lexicographic).
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Compute the `last=` cursor from the newest sales_date in a batch.
 * Uses exact UTC ISO instant comparison (arbitrary fraction digits, no ms truncation);
 * returns the original winning sales_date string.
 */
export function maxSalesCursor(entries: DlsiteSaleEntry[]): string | null {
  if (entries.length === 0) return null;
  let maxDate = entries[0]!.sales_date;
  for (let i = 1; i < entries.length; i++) {
    const candidate = entries[i]!.sales_date;
    if (compareUtcIsoInstants(candidate, maxDate) > 0) {
      maxDate = candidate;
    }
  }
  return maxDate;
}
