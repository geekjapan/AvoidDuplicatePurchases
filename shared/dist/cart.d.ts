/**
 * Cart delete/restore request builders for intervention stores (Issue #9).
 * URL/payload assembly only — no network calls.
 */
export type CartSource = "dlsite" | "fanza-doujin" | "fanza-books";
export interface CartRequest {
    url: string;
    method: "GET" | "POST" | "DELETE";
    headers: Record<string, string>;
    body?: string;
}
export declare function dlsiteDelete(workno: string): CartRequest;
export declare function dlsiteRestore(workno: string): CartRequest;
export declare function doujinDelete(cids: string[], csrfToken: string): CartRequest;
export declare function doujinRestore(cid: string, csrfToken: string): CartRequest;
export declare function booksDelete(cids: string[], ownUrl?: string): CartRequest;
export declare function booksRestore(cids: string[], ownUrl?: string): CartRequest;
export interface CartRequestContext {
    csrfToken?: string;
    ownUrl?: string;
}
/** DLsite emits one request per cid; FANZA stores batch into one request. */
export declare function buildDeleteRequests(source: CartSource, cids: string[], ctx?: CartRequestContext): CartRequest[];
export declare function buildRestoreRequests(source: CartSource, cids: string[], ctx?: CartRequestContext): CartRequest[];
//# sourceMappingURL=cart.d.ts.map