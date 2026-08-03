const WORKNO_RE = /^[BRV][JE]\d{6,8}$/;
function dlsiteFloorForWorkno(workno) {
    if (workno.startsWith("VJ"))
        return "pro";
    if (workno.startsWith("BJ"))
        return "books";
    return "maniax";
}
/** Build a canonical DLsite product page URL for lookup `other` links. */
export function dlsiteProductUrl(cid) {
    const workno = cid.toUpperCase();
    const floor = dlsiteFloorForWorkno(workno);
    return `https://www.dlsite.com/${floor}/work/=/product_id/${workno}.html`;
}
/** Public product.json endpoint (server fetches directly, no auth). */
export function dlsiteProductJsonUrl(workno) {
    return `https://www.dlsite.com/maniax/api/=/product.json?workno=${encodeURIComponent(workno)}&locale=ja-JP`;
}
export function isValidDlsiteWorkno(workno) {
    return WORKNO_RE.test(workno.toUpperCase());
}
/** FANZA Doujin product page (prototype/fanza confirmed via og:url / canonical). */
export function fanzaDoujinProductUrl(cid) {
    return `https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=${encodeURIComponent(cid)}/`;
}
/**
 * FANZA Books product page (prototype/fanza: series_id + content_id both required).
 * Returns null when seriesId is missing because the confirmed URL cannot be formed.
 */
export function fanzaBooksProductUrl(cid, seriesId) {
    const sid = typeof seriesId === "string" ? seriesId.trim() : "";
    if (!sid)
        return null;
    return `https://book.dmm.co.jp/product/${encodeURIComponent(sid)}/${encodeURIComponent(cid)}/`;
}
/**
 * FANZA Video product link.
 * Prototype confirms content lives under video.dmm.co.jp / digital video floors;
 * uses the long-standing DMM digital videoa detail path keyed by cid.
 */
export function fanzaVideoProductUrl(cid) {
    return `https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=${encodeURIComponent(cid)}/`;
}
/**
 * FANZA PC game (dlsoft) product link.
 * Prototype confirms the store host `dlsoft.dmm.co.jp`; detail path uses contentId.
 */
export function fanzaDlsoftProductUrl(cid) {
    return `https://dlsoft.dmm.co.jp/detail/${encodeURIComponent(cid)}/`;
}
/**
 * Map listing source to product URL (lookup `other` links).
 * Never returns example.invalid placeholders.
 */
export function productUrlForSource(source, cid, options = {}) {
    switch (source) {
        case "dlsite":
            return dlsiteProductUrl(cid);
        case "fanza_doujin":
            return fanzaDoujinProductUrl(cid);
        case "fanza_books": {
            const books = fanzaBooksProductUrl(cid, options.seriesId);
            // When series_id is absent, still avoid placeholders: surface the content id on the books host.
            // Callers that store listings should persist series_id for the confirmed two-segment URL.
            if (books)
                return books;
            return `https://book.dmm.co.jp/product/${encodeURIComponent(cid)}/`;
        }
        case "fanza_video":
            return fanzaVideoProductUrl(cid);
        case "fanza_dlsoft":
            return fanzaDlsoftProductUrl(cid);
        default: {
            // Exhaustiveness: all declared sources handled above.
            const _exhaustive = source;
            return _exhaustive;
        }
    }
}
//# sourceMappingURL=urls.js.map