import { isValidDlsiteWorkno } from "@adp/shared/adapters/dlsite";
import type { InterventionSource } from "@adp/shared";

const DL_WORKNO_RE = /\/product_id\/([BRV][JE]\d{6,8})(?:\.html)?/i;
const FANZA_DOUJIN_CID_RE = /\/cid=([^/]+)/i;
const FANZA_BOOKS_PRODUCT_RE = /^\/product\/\d+\/([^/]+)\/?$/i;

/** Parse only absolute https URLs; reject relative, non-https, and invalid strings. */
function parseHttpsUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Same-store product URL shape gate before CID extraction.
 * Hostname must be the canonical store host (not a lookalike suffix host).
 */
function isSameStoreProductUrl(source: InterventionSource, url: URL): boolean {
  switch (source) {
    case "dlsite":
      return (
        url.hostname === "www.dlsite.com" &&
        /\/work\/=\/product_id\/[A-Za-z0-9]+\.html$/i.test(url.pathname)
      );
    case "fanza_doujin":
      return (
        url.hostname === "www.dmm.co.jp" &&
        /^\/dc\/doujin\/-\/detail\/=\/cid=[^/]+\/?$/i.test(url.pathname)
      );
    case "fanza_books":
      return (
        url.hostname === "book.dmm.co.jp" &&
        /^\/product\/\d+\/[^/]+\/?$/i.test(url.pathname)
      );
    default:
      return false;
  }
}

/** Read canonical or og:url from a live document or fixture HTML string. */
export function readCanonicalUrl(doc: Document): string | null {
  const canonical = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  if (canonical) return canonical;
  const og = doc.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content;
  return og?.trim() || null;
}

/**
 * Extract a same-store product CID only from HTTPS canonical store product URLs.
 * External hosts, lookalike hosts, wrong paths, and non-HTTPS URLs return null.
 */
export function extractCidFromUrl(
  source: InterventionSource,
  url: string,
): string | null {
  const parsed = parseHttpsUrl(url);
  if (!parsed || !isSameStoreProductUrl(source, parsed)) return null;

  switch (source) {
    case "dlsite": {
      const match = DL_WORKNO_RE.exec(parsed.pathname);
      if (!match) return null;
      const workno = match[1]!.toUpperCase();
      return isValidDlsiteWorkno(workno) ? workno : null;
    }
    case "fanza_doujin": {
      const match = FANZA_DOUJIN_CID_RE.exec(parsed.pathname);
      return match?.[1]?.trim() || null;
    }
    case "fanza_books": {
      const match = FANZA_BOOKS_PRODUCT_RE.exec(parsed.pathname);
      return match?.[1]?.trim() || null;
    }
    default:
      return null;
  }
}

export function extractCidFromDocument(
  source: InterventionSource,
  doc: Document,
): string | null {
  // Prefer og:url / canonical product identity; location.href is fallback only.
  const pageUrl = readCanonicalUrl(doc) || doc.location?.href || null;
  if (!pageUrl) return null;
  return extractCidFromUrl(source, pageUrl);
}

export function extractListingCidsFromAnchors(
  source: InterventionSource,
  anchors: Iterable<HTMLAnchorElement>,
): Map<string, HTMLAnchorElement> {
  const items = new Map<string, HTMLAnchorElement>();
  for (const anchor of anchors) {
    const href = anchor.href;
    if (!href) continue;
    const cid = extractCidFromUrl(source, href);
    if (!cid || items.has(cid)) continue;
    items.set(cid, anchor);
  }
  return items;
}
