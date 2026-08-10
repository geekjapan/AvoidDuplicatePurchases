import type { DiscoverySource } from "../../messages.js";

export const MAX_URL_LENGTH = 2000;
export const DLSITE_TITLE_CODEPOINT_LIMIT = 255;
export const FANZA_DOUJIN_TITLE_CODEPOINT_LIMIT = 100;
const TITLE_HEAD_CODEPOINT_LIMIT = 24;

export type SearchUrlBuildResult =
  | { ok: true; url: string; keyword: string; truncated: boolean }
  | { ok: false; error: "empty_keyword" | "url_too_long" };

export type DiscoverySearchQuery = {
  url: string;
  keyword: string;
  truncated: boolean;
  variant: "full" | "without_leading_brackets" | "title_core" | "title_head";
};

export type SearchUrlsBuildResult =
  | { ok: true; queries: DiscoverySearchQuery[] }
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

function stripLeadingBracketedSegments(value: string): string {
  let current = value;
  // Campaign/edition labels are useful for display identity but often differ
  // between stores. Keep them in the primary query and remove them only for
  // fallback search terms.
  const leading = /^(?:【[^】]*】|\[[^\]]*\]|（[^）]*）|\([^)]*\))\s*/u;
  while (leading.test(current)) current = current.replace(leading, "").trim();
  return current;
}

function titleCore(value: string): string {
  return value.split(/[～〜~]/u, 1)[0]?.trim() ?? value;
}

function titleHead(value: string): string {
  return [...value].slice(0, TITLE_HEAD_CODEPOINT_LIMIT).join("").trim();
}

/**
 * Build a small, deterministic set of user-triggered search queries.
 *
 * Search engines on the two stores do not consistently index campaign labels,
 * subtitles, or punctuation in the same way. The primary query remains the
 * complete extracted title; shorter fallbacks only broaden discovery. The
 * strict title+maker identity gate still decides whether a result is usable.
 */
export function buildDiscoverySearchUrls(
  targetSource: DiscoverySource,
  title: string,
): SearchUrlsBuildResult {
  const cleaned = sanitizeSearchTitle(title);
  if (!cleaned) return { ok: false, error: "empty_keyword" };

  const withoutLeadingBrackets = stripLeadingBracketedSegments(cleaned);
  const core = titleCore(withoutLeadingBrackets);
  const head = titleHead(core);
  const variants: Array<{
    keyword: string;
    variant: DiscoverySearchQuery["variant"];
  }> = [
    { keyword: cleaned, variant: "full" },
    { keyword: withoutLeadingBrackets, variant: "without_leading_brackets" },
    { keyword: core, variant: "title_core" },
    { keyword: head, variant: "title_head" },
  ];

  const queries: DiscoverySearchQuery[] = [];
  const seen = new Set<string>();
  let lastError: "empty_keyword" | "url_too_long" = "empty_keyword";
  for (const candidate of variants) {
    const built = buildDiscoverySearchUrl(targetSource, candidate.keyword);
    if (!built.ok) {
      lastError = built.error;
      continue;
    }
    if (seen.has(built.keyword)) continue;
    seen.add(built.keyword);
    queries.push({
      url: built.url,
      keyword: built.keyword,
      truncated: built.truncated,
      variant: candidate.variant,
    });
  }

  if (queries.length === 0) return { ok: false, error: lastError };
  return { ok: true, queries };
}

/** Wave-1 counterpart floor only. */
export function counterpartSource(source: DiscoverySource): DiscoverySource {
  return source === "dlsite" ? "fanza_doujin" : "dlsite";
}
