export type ListingSource = "dlsite" | "fanza_doujin" | "fanza_books" | "fanza_video" | "fanza_dlsoft";
/** Build a canonical DLsite product page URL for lookup `other` links. */
export declare function dlsiteProductUrl(cid: string): string;
/** Public product.json endpoint (server fetches directly, no auth). */
export declare function dlsiteProductJsonUrl(workno: string): string;
export declare function isValidDlsiteWorkno(workno: string): boolean;
/** Optional inputs for source-specific product URL construction. */
export interface ProductUrlOptions {
    /**
     * Required for FANZA Books product pages
     * (`https://book.dmm.co.jp/product/<series_id>/<content_id>/`).
     */
    seriesId?: string | null;
}
/** FANZA Doujin product page (prototype/fanza confirmed via og:url / canonical). */
export declare function fanzaDoujinProductUrl(cid: string): string;
/**
 * FANZA Books product page (prototype/fanza: series_id + content_id both required).
 * Returns null when seriesId is missing because the confirmed URL cannot be formed.
 */
export declare function fanzaBooksProductUrl(cid: string, seriesId: string | null | undefined): string | null;
/**
 * FANZA Video product link.
 * Prototype confirms content lives under video.dmm.co.jp / digital video floors;
 * uses the long-standing DMM digital videoa detail path keyed by cid.
 */
export declare function fanzaVideoProductUrl(cid: string): string;
/**
 * FANZA PC game (dlsoft) product link.
 * Prototype confirms the store host `dlsoft.dmm.co.jp`; detail path uses contentId.
 */
export declare function fanzaDlsoftProductUrl(cid: string): string;
/**
 * Map listing source to product URL (lookup `other` links).
 * Never returns example.invalid placeholders.
 */
export declare function productUrlForSource(source: ListingSource, cid: string, options?: ProductUrlOptions): string;
//# sourceMappingURL=urls.d.ts.map