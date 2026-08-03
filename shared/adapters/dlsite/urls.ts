type ListingSource =
  | "dlsite"
  | "fanza_doujin"
  | "fanza_books"
  | "fanza_video"
  | "fanza_dlsoft";

const WORKNO_RE = /^[BRV][JE]\d{6,8}$/;

function dlsiteFloorForWorkno(workno: string): "pro" | "books" | "maniax" {
  if (workno.startsWith("VJ")) return "pro";
  if (workno.startsWith("BJ")) return "books";
  return "maniax";
}

/** Build a canonical DLsite product page URL for lookup `other` links. */
export function dlsiteProductUrl(cid: string): string {
  const workno = cid.toUpperCase();
  const floor = dlsiteFloorForWorkno(workno);
  return `https://www.dlsite.com/${floor}/work/=/product_id/${workno}.html`;
}

/** Public product.json endpoint (server fetches directly, no auth). */
export function dlsiteProductJsonUrl(workno: string): string {
  return `https://www.dlsite.com/maniax/api/=/product.json?workno=${encodeURIComponent(
    workno,
  )}&locale=ja-JP`;
}

export function isValidDlsiteWorkno(workno: string): boolean {
  return WORKNO_RE.test(workno.toUpperCase());
}

/** Map listing source to product URL (lookup responses). */
export function productUrlForSource(source: ListingSource, cid: string): string {
  if (source === "dlsite") return dlsiteProductUrl(cid);
  // FANZA URL builders are owned by future adapters; lookup still returns stable ids.
  return `https://example.invalid/${source}/${encodeURIComponent(cid)}`;
}
