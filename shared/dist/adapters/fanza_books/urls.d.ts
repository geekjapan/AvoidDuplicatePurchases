export type BooksShop = "all" | "adult";
/** Library listing uses shop_name=all (spec §4: includes general book.dmm.com). */
export declare function booksLibraryUrl(page: number, shop?: BooksShop): string;
export declare function booksContentsUrl(seriesId: string, page?: number, shop?: BooksShop): string;
export declare function booksProductUrl(seriesId: string, contentId: string): string;
//# sourceMappingURL=urls.d.ts.map