export type ListingSource =
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

/** Optional inputs for source-specific product URL construction. */
export interface ProductUrlOptions {
  /**
   * Required for FANZA Books product pages
   * (`https://book.dmm.co.jp/product/<series_id>/<content_id>/`).
   */
  seriesId?: string | null;
}

/** FANZA Doujin product page (prototype/fanza confirmed via og:url / canonical). */
export function fanzaDoujinProductUrl(cid: string): string {
  return `https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=${encodeURIComponent(cid)}/`;
}

/**
 * FANZA Books product page (prototype/fanza: series_id + content_id both required).
 * Returns null when seriesId is missing because the confirmed URL cannot be formed.
 */
export function fanzaBooksProductUrl(cid: string, seriesId: string | null | undefined): string | null {
  const sid = typeof seriesId === "string" ? seriesId.trim() : "";
  if (!sid) return null;
  return `https://book.dmm.co.jp/product/${encodeURIComponent(sid)}/${encodeURIComponent(cid)}/`;
}

/**
 * FANZA Video product link.
 * Prototype confirms content lives under video.dmm.co.jp / digital video floors;
 * uses the long-standing DMM digital videoa detail path keyed by cid.
 */
export function fanzaVideoProductUrl(cid: string): string {
  return `https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=${encodeURIComponent(cid)}/`;
}

/**
 * FANZA PC game (dlsoft) product link.
 * Prototype confirms the store host `dlsoft.dmm.co.jp`; detail path uses contentId.
 */
export function fanzaDlsoftProductUrl(cid: string): string {
  return `https://dlsoft.dmm.co.jp/detail/${encodeURIComponent(cid)}/`;
}

/**
 * Map listing source to product URL (lookup `other` links).
 * Never returns example.invalid placeholders.
 */
export function productUrlForSource(
  source: ListingSource,
  cid: string,
  options: ProductUrlOptions = {},
): string {
  switch (source) {
    case "dlsite":
      return dlsiteProductUrl(cid);
    case "fanza_doujin":
      return fanzaDoujinProductUrl(cid);
    case "fanza_books": {
      const books = fanzaBooksProductUrl(cid, options.seriesId);
      // When series_id is absent, still avoid placeholders: surface the content id on the books host.
      // Callers that store listings should persist series_id for the confirmed two-segment URL.
      if (books) return books;
      return `https://book.dmm.co.jp/product/${encodeURIComponent(cid)}/`;
    }
    case "fanza_video":
      return fanzaVideoProductUrl(cid);
    case "fanza_dlsoft":
      return fanzaDlsoftProductUrl(cid);
    default: {
      // Exhaustiveness: all declared sources handled above.
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}
