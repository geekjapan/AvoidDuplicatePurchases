export function dlsoftLibraryUrl(page: number): string {
  return `https://dlsoft.dmm.co.jp/ajax/v1/library?service=all&brand=&searchWord=&sort=order_desc&browserOnly=0&page=${page}`;
}
