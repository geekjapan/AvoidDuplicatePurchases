import type { InterventionSource } from "@adp/shared";
import { lookupItems } from "./lookup.js";
import type { ProductMeta } from "./types.js";
import { runProductPageWithLookup } from "./product-runner.js";

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
  await runProductPageWithLookup(source, doc, lookupItems);
}
