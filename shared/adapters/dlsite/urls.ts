export type ListingSource =
  | "dlsite"
  | "fanza_doujin"
  | "fanza_books"
  | "fanza_video"
  | "fanza_dlsoft";

/** Verified FANZA Video URL path floors (evidence: video.dmm.co.jp public product pages). */
export type FanzaVideoFloor = "av" | "amateur";

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
  /**
   * Required for FANZA Video product pages
   * (`https://video.dmm.co.jp/<floor>/content/?id=<content_id>`).
   * GraphQL case variants (e.g. `AV`) are normalized explicitly.
   */
  videoFloor?: string | null;
}

/** FANZA Doujin product page (prototype/fanza confirmed via og:url / canonical). */
export function fanzaDoujinProductUrl(cid: string): string {
  return `https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=${encodeURIComponent(cid)}/`;
}

/**
 * FANZA Books product page (prototype/fanza: series_id + content_id both required).
 * Returns null when seriesId is missing — never invents a one-segment fallback.
 */
export function fanzaBooksProductUrl(cid: string, seriesId: string | null | undefined): string | null {
  const sid = typeof seriesId === "string" ? seriesId.trim() : "";
  const contentId = cid.trim();
  if (!sid || !contentId) return null;
  return `https://book.dmm.co.jp/product/${encodeURIComponent(sid)}/${encodeURIComponent(contentId)}/`;
}

/**
 * Normalize GraphQL / evidence floor strings to verified URL path segments.
 * Accepts only explicit case variants of `av` and `amateur`. Does not infer from cid.
 */
export function normalizeFanzaVideoFloor(floor: unknown): FanzaVideoFloor | null {
  if (typeof floor !== "string") return null;
  const key = floor.trim().toLowerCase();
  if (key === "av") return "av";
  if (key === "amateur") return "amateur";
  return null;
}

/**
 * FANZA Video product URL (attempt8 public evidence).
 * Contract: `https://video.dmm.co.jp/<floor>/content/?id=<content_id>`
 * Requires an evidence-backed floor; returns null when floor is missing/unknown.
 */
export function fanzaVideoProductUrl(
  cid: string,
  floor: string | null | undefined,
): string | null {
  const pathFloor = normalizeFanzaVideoFloor(floor);
  const contentId = cid.trim();
  if (!pathFloor || !contentId) return null;
  return `https://video.dmm.co.jp/${pathFloor}/content/?id=${encodeURIComponent(contentId)}`;
}

/**
 * FANZA PC game (dlsoft) product URL (attempt8 public evidence).
 * Contract: `https://dlsoft.dmm.co.jp/detail/<contentId>/`
 */
export function fanzaDlsoftProductUrl(cid: string): string {
  return `https://dlsoft.dmm.co.jp/detail/${encodeURIComponent(cid.trim())}/`;
}

/**
 * Map listing source to a verified canonical product URL, or null when the
 * evidence required for that source is incomplete (Books series_id, Video floor).
 * Never returns example.invalid, store-root, or search placeholders.
 */
export function productUrlForSource(
  source: ListingSource,
  cid: string,
  options: ProductUrlOptions = {},
): string | null {
  switch (source) {
    case "dlsite":
      return dlsiteProductUrl(cid);
    case "fanza_doujin":
      return fanzaDoujinProductUrl(cid);
    case "fanza_books":
      return fanzaBooksProductUrl(cid, options.seriesId);
    case "fanza_video":
      return fanzaVideoProductUrl(cid, options.videoFloor);
    case "fanza_dlsoft":
      return fanzaDlsoftProductUrl(cid);
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}
