import type { CartRow } from "./types.js";

const PRODUCT_IDS_URL = "https://book.dmm.co.jp/ajax/bff/basket_product_ids/";

function readBooksRowFromDom(doc: Document, cid: string): CartRow | null {
  const items = doc.querySelectorAll<HTMLElement>("div");
  for (const host of Array.from(items)) {
    const itemId = host.getAttribute("data-item-id") ?? host.getAttribute("data-product-id");
    if (itemId !== cid) continue;
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
    rows.push(readBooksRowFromDom(doc, trimmed) ?? {
      cid: trimmed,
      title: trimmed,
      maker: null,
      host: doc.body,
    });
  }
  return rows;
}

export function parseBooksCartRowsFromPayload(
  doc: Document,
  payload: unknown,
): CartRow[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const ids = record.product_ids;
  if (!Array.isArray(ids)) return [];
  const productIds = ids.filter((id): id is string => typeof id === "string");
  return parseBooksCartRowsFromProductIds(doc, productIds);
}

export async function fetchBooksCartRows(
  doc: Document,
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<CartRow[]> {
  const response = await fetchFn(PRODUCT_IDS_URL, {
    credentials: "include",
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as unknown;
  return parseBooksCartRowsFromPayload(doc, payload);
}
