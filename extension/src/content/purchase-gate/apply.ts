import type { InterventionSource } from "@adp/shared";

import { isConfirmedDuplicate } from "./confirmed.js";
import {
  clearConfirmedDuplicateCids,
  writeConfirmedDuplicateCids,
  type GateStateStore,
} from "./gate-state.js";
import { isPurchaseGateMounted, mountPurchaseGate, unmountPurchaseGate } from "./mount.js";
import type { GateSurface } from "./types.js";
import type { LookupHit } from "../types.js";

export interface ConfirmedCidHit {
  cid: string;
  hit: LookupHit;
}

/**
 * Apply or clear a purchase gate from a set of confirmed-duplicate cids.
 * Also refreshes session gate state for purchase-progression pages.
 */
export function applyConfirmedDuplicateGate(
  doc: Document,
  source: InterventionSource,
  surface: GateSurface,
  confirmedCids: string[],
  store?: GateStateStore | null,
): { gated: boolean; ctaCount: number } {
  const unique = [...new Set(confirmedCids.map((c) => c.trim()).filter(Boolean))];
  if (unique.length === 0) {
    writeConfirmedDuplicateCids(source, [], store ?? undefined);
    if (isPurchaseGateMounted(doc)) unmountPurchaseGate(doc);
    else clearConfirmedDuplicateCids(source, store ?? undefined);
    return { gated: false, ctaCount: 0 };
  }
  writeConfirmedDuplicateCids(source, unique, store ?? undefined);
  const ctaCount = mountPurchaseGate(doc, surface);
  return { gated: true, ctaCount };
}

/** Collect cids whose lookup hits are confirmed duplicates. */
export function collectConfirmedDuplicateCids(
  rows: Array<{ cid: string }>,
  hits: Array<LookupHit | null | undefined>,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const hit = hits[i];
    if (!isConfirmedDuplicate(hit)) continue;
    const cid = rows[i]?.cid?.trim();
    if (cid) out.push(cid);
  }
  return out;
}

/** Product-page helper: gate immediate-buy only when the product hit is confirmed. */
export function applyProductImmediateBuyGate(
  doc: Document,
  source: InterventionSource,
  hit: LookupHit | null,
  store?: GateStateStore | null,
): { gated: boolean; ctaCount: number } {
  if (!isConfirmedDuplicate(hit)) {
    // Do not clear cart gate state from product page.
    if (isPurchaseGateMounted(doc)) unmountPurchaseGate(doc);
    return { gated: false, ctaCount: 0 };
  }
  // Product gate does not rewrite cart session state.
  void source;
  void store;
  const ctaCount = mountPurchaseGate(doc, "immediate_buy");
  return { gated: true, ctaCount };
}
