export type ListingSource = "dlsite" | "fanza_doujin" | "fanza_books" | "fanza_video" | "fanza_dlsoft" | "amazon" | "ebookjapan" | "kobo";
/** Verified FANZA Video URL path floors (evidence: video.dmm.co.jp public product pages). */
export type FanzaVideoFloor = "av" | "amateur";
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
    /**
     * Required for FANZA Video product pages
     * (`https://video.dmm.co.jp/<floor>/content/?id=<content_id>`).
     * GraphQL case variants (e.g. `AV`) are normalized explicitly.
     */
    videoFloor?: string | null;
}
/** FANZA Doujin product page (prototype/fanza confirmed via og:url / canonical). */
export declare function fanzaDoujinProductUrl(cid: string): string;
/**
 * FANZA Books product page (prototype/fanza: series_id + content_id both required).
 * Returns null when seriesId is missing — never invents a one-segment fallback.
 */
export declare function fanzaBooksProductUrl(cid: string, seriesId: string | null | undefined): string | null;
/**
 * Normalize GraphQL / evidence floor strings to verified URL path segments.
 * Accepts only explicit case variants of `av` and `amateur`. Does not infer from cid.
 */
export declare function normalizeFanzaVideoFloor(floor: unknown): FanzaVideoFloor | null;
/**
 * FANZA Video product URL (attempt8 public evidence).
 * Contract: `https://video.dmm.co.jp/<floor>/content/?id=<content_id>`
 * Requires an evidence-backed floor; returns null when floor is missing/unknown.
 */
export declare function fanzaVideoProductUrl(cid: string, floor: string | null | undefined): string | null;
/**
 * FANZA PC game (dlsoft) product URL (attempt8 public evidence).
 * Contract: `https://dlsoft.dmm.co.jp/detail/<contentId>/`
 */
export declare function fanzaDlsoftProductUrl(cid: string): string;
/**
 * Map listing source to a verified canonical product URL, or null when the
 * evidence required for that source is incomplete (Books series_id, Video floor).
 * Never returns example.invalid, store-root, or search placeholders.
 */
export declare function productUrlForSource(source: ListingSource, cid: string, options?: ProductUrlOptions): string | null;
//# sourceMappingURL=urls.d.ts.map