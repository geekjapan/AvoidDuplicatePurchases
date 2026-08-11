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
import { mountCartPriceComparison } from "./price-comparison.js";
import { readCartFinalPrice } from "./final-price.js";
import { resolveDoujinCartRows } from "./parse-doujin.js";
import { mountCartWarning } from "./warning.js";
import {
  normalizeCartCidLoad,
  type CartCidLoadResult,
  type CartLoadedItem,
  type CartLookupItem,
  type CartRow,
} from "./types.js";

export type CartRowParser = (doc: Document) => CartRow[] | Promise<CartRow[]>;

export type LookupFn = (
  items: CartLookupItem[],
) => Promise<LookupHit[] | null>;

export type CartCidLoader = () => Promise<CartCidLoadResult>;
export type CartRowObserver = (doc: Document, onChange: () => void) => () => void;

const CART_ROW_OBSERVE_TIMEOUT_MS = 10_000;

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

function toLookupItem(
  source: InterventionSource,
  item: CartLoadedItem,
  row: CartRow | undefined,
): CartLookupItem {
  const maker = row?.maker ?? item.maker;
  return {
    source,
    cid: item.cid,
    // Prefer DOM row metadata, then live basket API, then cid fallback.
    title: row?.title ?? item.title ?? item.cid,
    maker: maker ? maker : undefined,
  };
}

export interface RunCartPageOptions {
  /** Optional session store for cross-page gate state (tests inject a Map shim). */
  gateStore?: GateStateStore | null;
  /**
   * Optional live basket cid loader (FANZA basket APIs).
   *
   * When provided, whole-cart purchase gate is driven by these items + lookup,
   * even if DOM product-row hosts are missing (React SPA timing / host attrs).
   * Loaded title/maker are preserved for cross-store lookup when hosts are
   * absent. Row warnings still require exact hosts from parseRows. Loader
   * failure (`unavailable`) fail-opens and does not fall back to hostless
   * empty rows.
   */
  loadCartCids?: CartCidLoader;
  /** Test seam / live React hydration observer for delayed basket rows. */
  observeCartRows?: CartRowObserver;
}

function observeCartRows(doc: Document, onChange: () => void): () => void {
  if (typeof MutationObserver === "undefined" || !doc.body) return () => {};
  const observer = new MutationObserver(() => onChange());
  observer.observe(doc.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "data-content-id",
      "data-cid",
      "data-product-id",
      "data-item-id",
      "href",
      "class",
    ],
  });
  return () => observer.disconnect();
}

function mergeRows(primary: CartRow[], secondary: CartRow[]): CartRow[] {
  const byCid = new Map(primary.map((row) => [row.cid, row]));
  for (const row of secondary) {
    if (!byCid.has(row.cid)) byCid.set(row.cid, row);
  }
  return [...byCid.values()];
}

function mountPriceComparisons(
  doc: Document,
  source: InterventionSource,
  rows: readonly CartRow[],
  loadedItems: readonly CartLoadedItem[],
): void {
  if (source !== "dlsite" && source !== "fanza_doujin") return;
  const itemByCid = new Map(loadedItems.map((item) => [item.cid, item]));
  for (const row of rows) {
    const loaded = itemByCid.get(row.cid);
    const fallback = row.finalPrice ?? loaded?.finalPrice ?? null;
    const finalPrice = readCartFinalPrice(source, row.host, fallback);
    mountCartPriceComparison(doc, source, row, finalPrice);
  }
}

function allPriceComparisonsMounted(
  rows: readonly CartRow[],
  loadedItems: readonly CartLoadedItem[],
): boolean {
  if (loadedItems.length === 0) return true;
  const byCid = new Map(rows.map((row) => [row.cid, row]));
  return loadedItems.every((item) =>
    byCid
      .get(item.cid)
      ?.host.querySelector(".adp-cart-price-comparison"),
  );
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

    let rows: CartRow[] = [];
    // FANZA's API gives us authoritative item metadata. Resolve its product
    // hosts again after the live items are loaded, because the initial API
    // response can race React's row hydration.
    try {
      rows = await parseRows(doc);
    } catch {
      if (!options.loadCartCids) {
        // Silent: no rows, no error banner, no unhandled rejection.
        return 0;
      }
      // Host parsing is best-effort when the live API loader is available.
      rows = [];
    }

    // Resolve items for gate/lookup: prefer live basket API when wired (FANZA).
    let loadedItems: CartLoadedItem[];
    if (options.loadCartCids) {
      let loaded: CartCidLoadResult;
      try {
        loaded = await options.loadCartCids();
      } catch {
        return 0;
      }
      // Live basket failure must not treat empty DOM as empty cart.
      if (!Array.isArray(loaded)) return 0;
      loadedItems = normalizeCartCidLoad(loaded);
      if (loadedItems.length === 0) {
        applyConfirmedDuplicateGate(doc, source, "cart", [], options.gateStore);
        return 0;
      }
    } else {
      // DLsite (DOM-only): no rows → nothing to gate.
      if (rows.length === 0) return 0;
      loadedItems = rows.map((row) => ({
        cid: row.cid,
        title: row.title,
        maker: row.maker,
      }));
    }

    if (source === "fanza_doujin") {
      rows = mergeRows(rows, resolveDoujinCartRows(doc, loadedItems));
    }

    const cids = loadedItems.map((item) => item.cid);
    let rowByCid = new Map(rows.map((row) => [row.cid, row]));

    // Price comparison is independent of the ownership server. Mount the
    // user-triggered controls as soon as the cart rows are available, so a
    // temporary lookup outage cannot remove this read-only affordance.
    mountPriceComparisons(doc, source, rows, loadedItems);

    let stopObserving: (() => void) | null = null;
    let observeTimer: ReturnType<typeof setTimeout> | null = null;
    if (
      source === "fanza_doujin" &&
      loadedItems.length > 0 &&
      !allPriceComparisonsMounted(rows, loadedItems) &&
      (options.observeCartRows !== undefined || typeof MutationObserver !== "undefined")
    ) {
      const observe = options.observeCartRows ?? observeCartRows;
      const stop = observe(doc, () => {
        const hydrated = resolveDoujinCartRows(doc, loadedItems);
        if (hydrated.length === 0) return;
        const currentRows = mergeRows(rows, hydrated);
        rows = currentRows;
        rowByCid = new Map(rows.map((row) => [row.cid, row]));
        mountPriceComparisons(doc, source, rows, loadedItems);
        if (allPriceComparisonsMounted(rows, loadedItems)) {
          stopObserving?.();
          stopObserving = null;
        }
      });
      stopObserving = () => {
        stop();
        if (observeTimer !== null) clearTimeout(observeTimer);
        observeTimer = null;
      };
      observeTimer = setTimeout(() => {
        stopObserving?.();
        stopObserving = null;
      }, CART_ROW_OBSERVE_TIMEOUT_MS);
    }

    const items: CartLookupItem[] = loadedItems.map((item) =>
      toLookupItem(source, item, rowByCid.get(item.cid)),
    );

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
