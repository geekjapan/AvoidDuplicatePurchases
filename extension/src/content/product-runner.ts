import type { InterventionSource } from "@adp/shared";
import { mountProductBanner } from "./banner.js";
import { extractProductMeta } from "./meta.js";
import { applyProductImmediateBuyGate } from "./purchase-gate/index.js";
import type { LookupHit } from "./types.js";
import { buildProductLookupItem } from "./product-page.js";
import { reportOwnedPriceObservation } from "./report-price.js";

export type LookupFn = (
  items: ReturnType<typeof buildProductLookupItem>[],
) => Promise<LookupHit[] | null>;

export async function runProductPageWithLookup(
  source: InterventionSource,
  doc: Document,
  lookup: LookupFn,
  pageUrl?: string,
): Promise<LookupHit | null> {
  const meta = extractProductMeta(source, doc);
  if (!meta) return null;
  const results = await lookup([buildProductLookupItem(meta)]);
  // Lookup failure / empty: fail-open (no banner, no gate).
  if (!results?.[0]) return null;
  mountProductBanner(doc, results[0]);
  // Fail-closed immediate-buy only for confirmed duplicates (never possible).
  applyProductImmediateBuyGate(doc, source, results[0]);
  // Price observation only after ownership lookup succeeds (issue #45).
  if (results[0].owned) {
    void reportOwnedPriceObservation(source, meta, doc, pageUrl);
  }
  return results[0];
}
