import type { InterventionSource } from "@adp/shared";
import { lookupItems } from "./lookup.js";
import type { ProductMeta } from "./types.js";
import { runProductPageWithLookup } from "./product-runner.js";
import { hideDiscoveryOriginUi } from "./discovery/origin-ui.js";

export function buildProductLookupItem(meta: ProductMeta) {
  return {
    source: meta.source,
    cid: meta.cid,
    title: meta.title,
    maker: meta.maker ?? undefined,
  };
}

export async function runProductPage(
  source: InterventionSource,
  doc: Document = document,
): Promise<void> {
  const hit = await runProductPageWithLookup(source, doc, lookupItems);
  // Known owned products must not show cross-store compare CTA.
  // Lookup failure (null) keeps the independently mounted CTA.
  if (hit?.owned === true) {
    hideDiscoveryOriginUi(doc);
  }
}
