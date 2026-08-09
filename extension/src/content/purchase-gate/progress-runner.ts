import type { InterventionSource } from "@adp/shared";

import { lookupItems } from "../lookup.js";
import type { LookupHit } from "../types.js";
import {
  applyConfirmedDuplicateGate,
  collectConfirmedDuplicateCids,
} from "./apply.js";
import {
  readConfirmedDuplicateCids,
  type GateStateStore,
} from "./gate-state.js";
import { isPurchaseProgressPage } from "./page-kind.js";
import type { CartCidLoadResult } from "../cart/types.js";

export type ProgressLookupFn = (
  items: Array<{ source: InterventionSource; cid: string }>,
) => Promise<LookupHit[] | null>;

export type CartCidLoader = () => Promise<CartCidLoadResult>;

function readPathname(doc: Document): string {
  const loc = doc.location;
  if (loc?.pathname) return loc.pathname;
  if (loc?.href) {
    try {
      return new URL(loc.href).pathname;
    } catch {
      return "";
    }
  }
  return "";
}

/**
 * Fail-closed gate on purchase-progression pages (after cart, before payment complete).
 *
 * Strategy:
 * 1. Prefer live cart cid loader + lookup when provided (FANZA basket APIs / tests).
 * 2. Fall back to session state written on the cart page only when no live loader
 *    exists (DLsite has no cart list API).
 * 3. Live basket or lookup failure / empty unknown → do not gate (fail-open).
 */
export async function runPurchaseProgressPage(
  source: InterventionSource,
  doc: Document,
  options: {
    loadCartCids?: CartCidLoader;
    lookup?: ProgressLookupFn;
    store?: GateStateStore | null;
  } = {},
): Promise<{ gated: boolean; ctaCount: number }> {
  try {
    const pathname = readPathname(doc);
    if (!isPurchaseProgressPage(source, pathname)) {
      return { gated: false, ctaCount: 0 };
    }

    const lookup: ProgressLookupFn =
      options.lookup ??
      (async (items) => lookupItems(items));

    if (options.loadCartCids) {
      let loaded: CartCidLoadResult;
      try {
        loaded = await options.loadCartCids();
      } catch {
        return { gated: false, ctaCount: 0 };
      }
      // A live basket failure must not fall back to stale session cids.
      if (!Array.isArray(loaded)) return { gated: false, ctaCount: 0 };
      if (loaded.length === 0) {
        return applyConfirmedDuplicateGate(
          doc,
          source,
          "purchase_progress",
          [],
          options.store,
        );
      }
      const cids = loaded;

      let results: LookupHit[] | null;
      try {
        results = await lookup(cids.map((cid) => ({ source, cid })));
      } catch {
        return { gated: false, ctaCount: 0 };
      }
      // Fail-open on lookup null (server down / unknown).
      if (!results) return { gated: false, ctaCount: 0 };
      const confirmed = collectConfirmedDuplicateCids(
        cids.map((cid) => ({ cid })),
        results,
      );
      return applyConfirmedDuplicateGate(
        doc,
        source,
        "purchase_progress",
        confirmed,
        options.store,
      );
    }

    // Fallback: session state from cart page (especially DLsite).
    const stored = readConfirmedDuplicateCids(source, options.store ?? undefined);
    if (stored.length === 0) {
      return applyConfirmedDuplicateGate(
        doc,
        source,
        "purchase_progress",
        [],
        options.store,
      );
    }
    // Re-validate stored cids when lookup is available; fail-open if lookup null.
    let results: LookupHit[] | null;
    try {
      results = await lookup(stored.map((cid) => ({ source, cid })));
    } catch {
      return { gated: false, ctaCount: 0 };
    }
    if (!results) return { gated: false, ctaCount: 0 };
    const confirmed = collectConfirmedDuplicateCids(
      stored.map((cid) => ({ cid })),
      results,
    );
    return applyConfirmedDuplicateGate(
      doc,
      source,
      "purchase_progress",
      confirmed,
      options.store,
    );
  } catch {
    return { gated: false, ctaCount: 0 };
  }
}
