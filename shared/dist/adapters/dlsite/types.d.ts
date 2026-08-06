/** One row from `GET play.dlsite.com/api/v3/content/sales`. */
export interface DlsiteSaleEntry {
    workno: string;
    sales_date: string;
    /**
     * Untouched original sales API object (including unknown fields).
     * Used for listing.raw_json evidence; derived fields above stay validated.
     */
    raw?: Record<string, unknown>;
}
/** Subset of public `product.json` fields used for listing metadata. */
export interface DlsiteProductInfo {
    workno: string;
    work_name: string;
    maker_name?: string | null;
    series_id?: string | null;
    image_url?: string | null;
    /**
     * Untouched original product.json item (all fields, e.g. work_pack_parent).
     * Stored into listing.raw_json for future work_relation / resilience.
     */
    raw?: Record<string, unknown>;
}
/** Normalized listing row produced by the DLsite adapter parse step. */
export interface DlsiteParsedListing {
    cid: string;
    title: string;
    maker: string | null;
    seriesId: string | null;
    imageUrl: string | null;
    purchasedAt: string;
    purchasedAtPrecision: "second";
    rawJson: string;
}
//# sourceMappingURL=types.d.ts.map