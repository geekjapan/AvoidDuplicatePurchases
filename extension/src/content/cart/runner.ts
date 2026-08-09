import type { InterventionSource } from "@adp/shared";

import { createCartDeleter } from "../../cart-deleter/index.js";
import { lookupItems } from "../lookup.js";
import {
  applyConfirmedDuplicateGate,
  collectConfirmedDuplicateCids,
  isConfirmedDuplicate,
  type GateStateStore,
} from "../purchase-gate/index.js";
import type { LookupHit } from "../types.js";
import { interventionToCartSource, isCartInterventionPage } from "./page-kind.js";
import { mountCartWarning } from "./warning.js";
import type { CartCidLoadResult, CartLookupItem, CartRow } from "./types.js";

export type CartRowParser = (doc: Document) => CartRow[] | Promise<CartRow[]>;

export type LookupFn = (
  items: CartLookupItem[],
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

export interface RunCartPageOptions {
  /** Optional session store for cross-page gate state (tests inject a Map shim). */
  gateStore?: GateStateStore | null;
  /**
   * Optional live basket cid loader (FANZA basket APIs).
   *
   * When provided, whole-cart purchase gate is driven by these cids + lookup,
   * even if DOM product-row hosts are missing (React SPA timing / host attrs).
   * Row warnings still require exact hosts from parseRows. Loader failure
   * (`unavailable`) fail-opens and does not fall back to hostless empty rows.
   */
  loadCartCids?: CartCidLoader;
}

/**
 * Cart intervention: row warnings + delete, and whole-cart purchase gate while
 * any confirmed duplicate remains (ADR-0001). Lookup failure → fail-open.
 */
export async function runCartPage(
  source: InterventionSource,
  doc: Document,
  parseRows: CartRowParser,
  lookup: LookupFn = async (items) => lookupItems(items),
  options: RunCartPageOptions = {},
): Promise<number> {
  try {
    const pathname = readPathname(doc);
    if (!isCartInterventionPage(source, pathname)) return 0;

    let rows: CartRow[];
    try {
      rows = await parseRows(doc);
    } catch {
      // Silent: no rows, no error banner, no unhandled rejection.
      return 0;
    }

    // Resolve cids for gate/lookup: prefer live basket API when wired (FANZA).
    let cids: string[];
    if (options.loadCartCids) {
      let loaded: CartCidLoadResult;
      try {
        loaded = await options.loadCartCids();
      } catch {
        return 0;
      }
      // Live basket failure must not treat empty DOM as empty cart.
      if (!Array.isArray(loaded)) return 0;
      cids = loaded.map((c) => c.trim()).filter(Boolean);
      if (cids.length === 0) {
        applyConfirmedDuplicateGate(doc, source, "cart", [], options.gateStore);
        return 0;
      }
    } else {
      // DLsite (DOM-only): no rows → nothing to gate.
      if (rows.length === 0) return 0;
      cids = rows.map((row) => row.cid);
    }

    const rowByCid = new Map(rows.map((row) => [row.cid, row]));
    const items: CartLookupItem[] = cids.map((cid) => {
      const row = rowByCid.get(cid);
      return {
        source,
        cid,
        title: row?.title ?? cid,
        maker: row?.maker ?? undefined,
      };
    });

    let results: LookupHit[] | null;
    try {
      results = await lookup(items);
    } catch {
      return 0;
    }
    // Fail-open when lookup is unavailable.
    if (!results) return 0;

    const cartSource = interventionToCartSource(source);
    // Deleter re-reads live pathname + page context on every remove/restore.
    const deleter = createCartDeleter({
      source: cartSource,
      doc,
    });

    const confirmed = new Set(
      collectConfirmedDuplicateCids(
        cids.map((cid) => ({ cid })),
        results,
      ),
    );

    const refreshGate = (): void => {
      applyConfirmedDuplicateGate(
        doc,
        source,
        "cart",
        [...confirmed],
        options.gateStore,
      );
    };

    let warned = 0;
    for (let i = 0; i < cids.length; i++) {
      const hit = results[i];
      if (!hit || !isConfirmedDuplicate(hit)) continue;
      const cid = cids[i]!;
      const row = rowByCid.get(cid);
      // Only exact product-row hosts (parsers already skip unmatched / body).
      if (!row?.host || row.host === doc.body) continue;
      mountCartWarning(
        doc,
        row,
        hit,
        deleter,
        (removedCid) => {
          confirmed.delete(removedCid);
          refreshGate();
        },
        (restoredCid) => {
          confirmed.add(restoredCid);
          refreshGate();
        },
      );
      warned += 1;
    }

    refreshGate();
    return warned;
  } catch {
    return 0;
  }
}
