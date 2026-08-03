const WORKNO_RE = /^[BRV][JE]\d{6,8}$/;
/** Build a canonical DLsite product page URL for lookup `other` links. */
export function dlsiteProductUrl(cid) {
    const workno = cid.toUpperCase();
    const floor = workno.startsWith("VJ") ? "pro" : workno.startsWith("BJ") ? "books" : "maniax";
    return `https://www.dlsite.com/${floor}/work/=/product_id/${workno}.html`;
}
/** Public product.json endpoint (server fetches directly, no auth). */
export function dlsiteProductJsonUrl(workno) {
    return `https://www.dlsite.com/maniax/api/=/product.json?workno=${encodeURIComponent(workno)}&locale=ja-JP`;
}
export function isValidDlsiteWorkno(workno) {
    return WORKNO_RE.test(workno.toUpperCase());
}
/** Map listing source to product URL (lookup responses). */
export function productUrlForSource(source, cid) {
    if (source === "dlsite")
        return dlsiteProductUrl(cid);
    // FANZA URL builders are owned by future adapters; lookup still returns stable ids.
    return `https://example.invalid/${source}/${encodeURIComponent(cid)}`;
}
//# sourceMappingURL=urls.js.map