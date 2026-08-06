export type BooksShop = "all" | "adult";

/** Library listing uses shop_name=all (spec §4: includes general book.dmm.com). */
export function booksLibraryUrl(page: number, shop: BooksShop = "all"): string {
  return `https://book.dmm.co.jp/ajax/bff/library/?shop_name=${shop}&page=${page}&order=added_desc&show_expired=0&format_webp=1`;
}

export function booksContentsUrl(
  seriesId: string,
  page = 1,
  shop: BooksShop = "all",
): string {
  return `https://book.dmm.co.jp/ajax/bff/contents/?shop_name=${shop}&series_id=${encodeURIComponent(
    seriesId,
  )}&page=${page}&per_page=100&order=asc&purchase_status=purchased&format_webp=1`;
}

export function booksProductUrl(seriesId: string, contentId: string): string {
  return `https://book.dmm.co.jp/product/${encodeURIComponent(seriesId)}/${encodeURIComponent(
    contentId,
  )}/`;
}
