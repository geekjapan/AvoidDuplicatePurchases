/** FANZA Doujin mylibraries API: limit above 100 is rejected (returns 0 items). */
export const DOUJIN_LIMIT_MAX = 100;

export function doujinLibraryUrl(page: number, limit = DOUJIN_LIMIT_MAX): string {
  const capped = Math.min(Math.max(1, limit), DOUJIN_LIMIT_MAX);
  return `https://www.dmm.co.jp/dc/doujin/api/mylibraries/?page=${page}&sort=purchasedate_desc&genre=all&limit=${capped}`;
}
