import type { FanzaDlsoftParsedListing } from "./types.js";
/** Parse dlsoft library page; no purchase date (deliveryBeginDate is not purchased_at). */
export declare function parseDlsoftLibraryPayload(raw: unknown): FanzaDlsoftParsedListing[];
export declare function dlsoftPageHasNext(raw: unknown, fetchedSoFar: number): boolean;
export declare function dlsoftPageInfo(raw: unknown): {
    itemCount: number;
    totalCount: number;
};
//# sourceMappingURL=parse.d.ts.map