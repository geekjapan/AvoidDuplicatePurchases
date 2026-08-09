import type { InterventionSource } from "@adp/shared";
import { MSG_PRICE_OBSERVATION } from "../messages.js";
import {
  extractVisiblePriceTiers,
  hasAnyTier,
  type ObservedPriceTiers,
} from "./price-observation.js";
import type { ProductMeta } from "./types.js";

/**
 * After ownership lookup succeeds, observe visible product-page price tiers
 * and post them for the owned listing. Never applies coupons or mutates the page.
 */
export async function reportOwnedPriceObservation(
  source: InterventionSource,
  meta: ProductMeta,
  doc: Document,
  pageUrl: string = typeof location !== "undefined" ? location.href : "",
): Promise<boolean> {
  const tiers: ObservedPriceTiers = extractVisiblePriceTiers(source, doc);
  if (!hasAnyTier(tiers) || !pageUrl) return false;
  try {
    const reply = (await chrome.runtime.sendMessage({
      type: MSG_PRICE_OBSERVATION,
      source,
      cid: meta.cid,
      pageUrl,
      regular: tiers.regular,
      sale: tiers.sale,
      coupon: tiers.coupon,
    })) as { ok?: boolean } | undefined;
    return reply?.ok === true;
  } catch {
    return false;
  }
}
