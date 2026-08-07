/** Library listing uses shop_name=all (spec §4: includes general book.dmm.com). */
export function booksLibraryUrl(page, shop = "all") {
    return `https://book.dmm.co.jp/ajax/bff/library/?shop_name=${shop}&page=${page}&order=added_desc&show_expired=0&format_webp=1`;
}
export function booksContentsUrl(seriesId, page = 1, shop = "adult") {
    return `https://book.dmm.co.jp/ajax/bff/contents/?shop_name=${shop}&series_id=${encodeURIComponent(seriesId)}&page=${page}&per_page=100&order=asc&purchase_status=purchased&format_webp=1`;
}
export function booksProductUrl(seriesId, contentId) {
    return `https://book.dmm.co.jp/product/${encodeURIComponent(seriesId)}/${encodeURIComponent(contentId)}/`;
}
//# sourceMappingURL=urls.js.map