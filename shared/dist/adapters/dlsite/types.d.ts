/** One row from `GET play.dlsite.com/api/v3/content/sales`. */
export interface DlsiteSaleEntry {
    workno: string;
    sales_date: string;
}
/** Subset of public `product.json` fields used for listing metadata. */
export interface DlsiteProductInfo {
    workno: string;
    work_name: string;
    maker_name?: string | null;
    series_id?: string | null;
    image_url?: string | null;
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