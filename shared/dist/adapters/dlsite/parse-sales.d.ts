import type { DlsiteParsedListing, DlsiteSaleEntry } from "./types.js";
/**
 * Strict UTC ISO-8601 instant: `YYYY-MM-DDTHH:mm:ss[.fraction]Z` only.
 * Rejects locale dates, offset timezones, and impossible calendar days (e.g. Feb 30).
 */
export declare function isStrictUtcIsoInstant(value: string): boolean;
/**
 * Parse raw extension payload from DLsite sales API.
 * Accepts a non-empty array of sale entries or `{ items: [...] }`.
 * Invalid entries reject the entire batch (no silent drop).
 */
export declare function parseDlsiteSalesPayload(raw: unknown): DlsiteSaleEntry[];
/** Build a listing stub from sales history alone (product.json unavailable). */
export declare function listingFromSale(entry: DlsiteSaleEntry): DlsiteParsedListing;
/** Merge product.json metadata into a sales-derived listing. */
export declare function mergeProductInfo(sale: DlsiteSaleEntry, product: {
    work_name?: string;
    maker_name?: string | null;
    series_id?: string | null;
    image_url?: string | null;
} | null): DlsiteParsedListing;
/**
 * Compute the `last=` cursor from the newest sales_date in a batch.
 * Compares by parsed UTC instant; returns the original winning sales_date string.
 */
export declare function maxSalesCursor(entries: DlsiteSaleEntry[]): string | null;
//# sourceMappingURL=parse-sales.d.ts.map