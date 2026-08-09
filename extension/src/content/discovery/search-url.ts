import type { DiscoverySource } from "../../messages.js";

export const MAX_URL_LENGTH = 2000;
export const DLSITE_TITLE_CODEPOINT_LIMIT = 255;
export const FANZA_DOUJIN_TITLE_CODEPOINT_LIMIT = 100;

export type SearchUrlBuildResult =
  | { ok: true; url: string; keyword: string; truncated: boolean }
  | { ok: false; error: "empty_keyword" | "url_too_long" };

/** Strip control characters / newlines before encoding a search keyword. */
export function sanitizeSearchTitle(title: string): string {
  // Build the control-char class without a literal control-regex (eslint no-control-regex).
  const controls = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(31)}\u007F-\u009F]`, "g");
  return title
    .replace(controls, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Truncate on Unicode code-point boundary (not UTF-16 code units). */
export function truncateCodePoints(value: string, maxCodePoints: number): {
  text: string;
  truncated: boolean;
} {
  const points = [...value];
  if (points.length <= maxCodePoints) return { text: value, truncated: false };
  return { text: points.slice(0, maxCodePoints).join(""), truncated: true };
}

/**
 * Build the confirmed public search URL for wave-1 discovery.
 * DLsite: maniax fsr keyword path (max 255 code points).
 * FANZA Doujin: list/narrow word path (max 100 code points).
 * Full URL length must be ≤ 2000; longer is fail-closed.
 */
export function buildDiscoverySearchUrl(
  targetSource: DiscoverySource,
  title: string,
): SearchUrlBuildResult {
  const cleaned = sanitizeSearchTitle(title);
  if (!cleaned) return { ok: false, error: "empty_keyword" };

  const limit =
    targetSource === "dlsite"
      ? DLSITE_TITLE_CODEPOINT_LIMIT
      : FANZA_DOUJIN_TITLE_CODEPOINT_LIMIT;
  const { text: keyword, truncated } = truncateCodePoints(cleaned, limit);
  const encoded = encodeURIComponent(keyword);

  const url =
    targetSource === "dlsite"
      ? `https://www.dlsite.com/maniax/fsr/=/keyword/${encoded}/`
      : `https://www.dmm.co.jp/dc/doujin/-/list/narrow/=/word=${encoded}/`;

  if (url.length > MAX_URL_LENGTH) return { ok: false, error: "url_too_long" };
  return { ok: true, url, keyword, truncated };
}

/** Wave-1 counterpart floor only. */
export function counterpartSource(source: DiscoverySource): DiscoverySource {
  return source === "dlsite" ? "fanza_doujin" : "dlsite";
}
