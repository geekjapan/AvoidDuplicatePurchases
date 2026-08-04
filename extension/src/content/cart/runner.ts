import type { InterventionSource } from "@adp/shared";

import { createCartDeleter, readCartContext } from "../../cart-deleter/index.js";
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
  const pathname = readPathname(doc);
  if (!isCartInterventionPage(source, pathname)) return 0;

  const rows = await parseRows(doc);
  if (rows.length === 0) return 0;

  const items = rows.map((row) => ({
    source,
    cid: row.cid,
    title: row.title,
    maker: row.maker ?? undefined,
  }));
  const results = await lookup(items);
  if (!results) return 0;

  const cartSource = interventionToCartSource(source);
  const deleter = createCartDeleter({
    source: cartSource,
    pathname,
    context: readCartContext(cartSource, doc),
  });

  let warned = 0;
  for (let i = 0; i < rows.length; i++) {
    const hit = results[i];
    if (!hit || !isDuplicate(hit)) continue;
    mountCartWarning(doc, rows[i]!, hit, deleter);
    warned += 1;
  }
  return warned;
}
