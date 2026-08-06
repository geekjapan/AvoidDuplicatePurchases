import type { InterventionSource } from "@adp/shared";
import { mountProductBanner } from "./banner.js";
import { extractProductMeta } from "./meta.js";
import type { LookupHit } from "./types.js";
import { buildProductLookupItem } from "./product-page.js";

export type LookupFn = (
  items: ReturnType<typeof buildProductLookupItem>[],
) => Promise<LookupHit[] | null>;

export async function runProductPageWithLookup(
  source: InterventionSource,
  doc: Document,
  lookup: LookupFn,
): Promise<LookupHit | null> {
  const meta = extractProductMeta(source, doc);
  if (!meta) return null;
  const results = await lookup([buildProductLookupItem(meta)]);
  if (!results?.[0]) return null;
  mountProductBanner(doc, results[0]);
  return results[0];
}
