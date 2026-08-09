import { z } from "zod";

import type { CartRow } from "./types.js";

const PRODUCT_IDS_URL = "https://book.dmm.co.jp/ajax/bff/basket_product_ids/";

const NonBlankString = z.string().trim().min(1);

/** Strict local schema for FANZA Books basket product-ids payload (cart trust boundary). */
const BooksProductIdsPayloadSchema = z
  .object({
    product_ids: z.array(NonBlankString),
  })
  .strict();

function readBooksRowFromDom(doc: Document, cid: string): CartRow | null {
  const items = doc.querySelectorAll<HTMLElement>("div");
  for (const host of Array.from(items)) {
    const itemId = host.getAttribute("data-item-id") ?? host.getAttribute("data-product-id");
    if (itemId !== cid) continue;
    // Never use document.body as a warning host.
    if (host === doc.body) continue;
    const title =
      host.querySelector(".title, .product-title, [class*='title']")?.textContent?.trim() ||
      cid;
    const maker =
      host.querySelector(".author, .maker, [class*='author']")?.textContent?.trim() || null;
    return { cid, title, maker, host };
  }
  return null;
}

export function parseBooksCartRowsFromProductIds(
  doc: Document,
  productIds: string[],
): CartRow[] {
  const rows: CartRow[] = [];
  for (const cid of productIds) {
    const trimmed = cid.trim();
    if (!trimmed) continue;
    const row = readBooksRowFromDom(doc, trimmed);
    // Unknown / unmatched cid: skip (no body fallback).
    if (!row) continue;
    rows.push(row);
  }
  return rows;
}

export function parseBooksCartRowsFromPayload(
  doc: Document,
  payload: unknown,
): CartRow[] {
  const parsed = BooksProductIdsPayloadSchema.safeParse(payload);
  if (!parsed.success) return [];
  try {
    return parseBooksCartRowsFromProductIds(doc, parsed.data.product_ids);
  } catch {
    return [];
  }
}

export async function fetchBooksCartRows(
  doc: Document,
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<CartRow[]> {
  try {
    const response = await fetchFn(PRODUCT_IDS_URL, {
      credentials: "include",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    if (!response.ok) return [];
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return [];
    }
    return parseBooksCartRowsFromPayload(doc, payload);
  } catch {
    // Network rejection or unexpected throw: silent empty (no banner / no rethrow).
    return [];
  }
}

/**
 * Cids only (no DOM host matching). Used on purchase-progression pages where
 * basket row hosts may be absent.
 */
export async function fetchBooksCartCids(
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<string[]> {
  try {
    const response = await fetchFn(PRODUCT_IDS_URL, {
      credentials: "include",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    if (!response.ok) return [];
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return [];
    }
    const parsed = BooksProductIdsPayloadSchema.safeParse(payload);
    if (!parsed.success) return [];
    return parsed.data.product_ids.map((id) => id.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
