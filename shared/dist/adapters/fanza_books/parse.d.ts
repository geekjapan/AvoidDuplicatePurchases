import type { FanzaBooksImportPayload, FanzaBooksParsedListing, FanzaBooksSeriesRef } from "./types.js";
/** Extract purchasable series refs from a library page (shop_name=all scope). */
export declare function parseBooksLibraryPayload(raw: unknown): FanzaBooksSeriesRef[];
export declare function booksLibraryHasNext(raw: unknown): boolean;
/** Parse one contents page; purchased volumes only; second-precision ISO8601 dates. */
export declare function parseBooksContentsPayload(raw: unknown, seriesId: string, author?: string | null, seriesRaw?: Record<string, unknown> | null): FanzaBooksParsedListing[];
/** Normalize extension POST body `{ seriesId, author?, seriesRaw?, payload }`. */
export declare function parseBooksImportBody(raw: unknown): FanzaBooksImportPayload;
export declare function parseBooksImportPayload(raw: unknown): FanzaBooksParsedListing[];
export declare function booksContentsHasNext(raw: unknown): boolean;
//# sourceMappingURL=parse.d.ts.map