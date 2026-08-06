import type { InterventionSource } from "@adp/shared";

import { createCartDeleter } from "../../cart-deleter/index.js";
import { lookupItems } from "../lookup.js";
import type { LookupHit } from "../types.js";
import { interventionToCartSource, isCartInterventionPage } from "./page-kind.js";
import { mountCartWarning } from "./warning.js";
import type { CartLookupItem, CartRow } from "./types.js";

export type CartRowParser = (doc: Document) => CartRow[] | Promise<CartRow[]>;

export type LookupFn = (
  items: CartLookupItem[],
) => Promise<LookupHit[] | null>;

function isDuplicate(hit: LookupHit): boolean {
  return hit.owned || hit.other.length > 0;
}

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

export async function runCartPage(
  source: InterventionSource,
  doc: Document,
  parseRows: CartRowParser,
  lookup: LookupFn = async (items) => lookupItems(items),
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
    if (!results) return 0;

    const cartSource = interventionToCartSource(source);
    // Deleter re-reads live pathname + page context on every remove/restore.
    const deleter = createCartDeleter({
      source: cartSource,
      doc,
    });

    let warned = 0;
    for (let i = 0; i < rows.length; i++) {
      const hit = results[i];
      if (!hit || !isDuplicate(hit)) continue;
      const row = rows[i]!;
      // Only exact product-row hosts (parsers already skip unmatched / body).
      if (!row.host || row.host === doc.body) continue;
      mountCartWarning(doc, row, hit, deleter);
      warned += 1;
    }
    return warned;
  } catch {
    return 0;
  }
}
