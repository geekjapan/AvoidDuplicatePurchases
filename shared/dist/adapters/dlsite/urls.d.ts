type ListingSource = "dlsite" | "fanza_doujin" | "fanza_books" | "fanza_video" | "fanza_dlsoft";
/** Build a canonical DLsite product page URL for lookup `other` links. */
export declare function dlsiteProductUrl(cid: string): string;
/** Public product.json endpoint (server fetches directly, no auth). */
export declare function dlsiteProductJsonUrl(workno: string): string;
export declare function isValidDlsiteWorkno(workno: string): boolean;
/** Map listing source to product URL (lookup responses). */
export declare function productUrlForSource(source: ListingSource, cid: string): string;
export {};
//# sourceMappingURL=urls.d.ts.map