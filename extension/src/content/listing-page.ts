import type { InterventionSource } from "@adp/shared";
import { extractListingCidsFromAnchors } from "./cid.js";
import { lookupItems } from "./lookup.js";
import { applyListingOverlays } from "./overlay.js";

function listingAnchors(doc: Document, source: InterventionSource): HTMLAnchorElement[] {
  const selector =
    source === "dlsite"
      ? 'a[href*="product_id/"]'
      : source === "fanza_doujin"
        ? 'a[href*="cid="]'
        : 'a[href*="/product/"]';
  const nodes = doc.querySelectorAll<HTMLAnchorElement>(selector);
  const anchors: HTMLAnchorElement[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes.item(i);
    if (node) anchors.push(node);
  }
  return anchors;
}

export async function runListingPage(
  source: InterventionSource,
  doc: Document = document,
): Promise<void> {
  const anchorsByCid = extractListingCidsFromAnchors(source, listingAnchors(doc, source));
  if (anchorsByCid.size === 0) return;

  const items = [...anchorsByCid.keys()].map((cid) => ({ source, cid }));
  const results = await lookupItems(items);
  if (!results) return;

  const ownedByCid = new Map<string, boolean>();
  [...anchorsByCid.keys()].forEach((cid, index) => {
    ownedByCid.set(cid, results[index]?.owned === true);
  });
  applyListingOverlays(doc, ownedByCid, anchorsByCid);
}
