import { isValidDlsiteWorkno } from "@adp/shared/adapters/dlsite";
import type { InterventionSource } from "@adp/shared";

const DL_WORKNO_RE = /product_id\/([BRV][JE]\d{6,8})/i;
const FANZA_DOUJIN_CID_RE = /cid=([^/&]+)/i;
const FANZA_BOOKS_PRODUCT_RE = /\/product\/(\d+)\/([^/?#]+)/i;

/** Read canonical or og:url from a live document or fixture HTML string. */
export function readCanonicalUrl(doc: Document): string | null {
  const canonical = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  if (canonical) return canonical;
  const og = doc.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content;
  return og?.trim() || null;
}

export function extractCidFromUrl(
  source: InterventionSource,
  url: string,
): string | null {
  switch (source) {
    case "dlsite": {
      const match = DL_WORKNO_RE.exec(url);
      if (!match) return null;
      const workno = match[1]!.toUpperCase();
      return isValidDlsiteWorkno(workno) ? workno : null;
    }
    case "fanza_doujin": {
      const match = FANZA_DOUJIN_CID_RE.exec(url);
      return match?.[1]?.trim() ?? null;
    }
    case "fanza_books": {
      const match = FANZA_BOOKS_PRODUCT_RE.exec(url);
      return match?.[2]?.trim() ?? null;
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
