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
import type { CartLookupItem, CartRow } from "./types.js";

export type CartRowParser = (doc: Document) => CartRow[] | Promise<CartRow[]>;

export type LookupFn = (
  items: CartLookupItem[],
) => Promise<LookupHit[] | null>;

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
    if (rows.length === 0) return 0;

    const items = rows.map((row) => ({
      source,
      cid: row.cid,
      title: row.title,
      maker: row.maker ?? undefined,
    }));

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

    const confirmed = new Set(collectConfirmedDuplicateCids(rows, results));

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
    for (let i = 0; i < rows.length; i++) {
      const hit = results[i];
      if (!hit || !isConfirmedDuplicate(hit)) continue;
      const row = rows[i]!;
      // Only exact product-row hosts (parsers already skip unmatched / body).
      if (!row.host || row.host === doc.body) continue;
      mountCartWarning(
        doc,
        row,
        hit,
        deleter,
        (cid) => {
          confirmed.delete(cid);
          refreshGate();
        },
        (cid) => {
          confirmed.add(cid);
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
