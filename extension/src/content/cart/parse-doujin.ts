import type { CartRow } from "./types.js";

const BASKETS_URL = "https://www.dmm.co.jp/dc/doujin/api/baskets/";

interface DoujinBasketItem {
  content_id?: string;
  contentId?: string;
  title?: string;
  maker_name?: string;
  makerName?: string;
}

function readItemField(item: DoujinBasketItem, cidKey: "content_id" | "contentId"): string | null {
  const raw = item[cidKey];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function mapApiRows(doc: Document, items: DoujinBasketItem[]): CartRow[] {
  const rows: CartRow[] = [];
  for (const item of items) {
    const cid = readItemField(item, "content_id") ?? readItemField(item, "contentId");
    if (!cid) continue;
    let host: HTMLElement = doc.body;
    const divs = doc.querySelectorAll<HTMLElement>("div");
    for (const candidate of Array.from(divs)) {
      if (
        candidate.getAttribute("data-content-id") === cid ||
        candidate.getAttribute("data-cid") === cid
      ) {
        host = candidate;
        break;
      }
    }
    rows.push({
      cid,
      title: item.title?.trim() || cid,
      maker: item.maker_name?.trim() || item.makerName?.trim() || null,
      host,
    });
  }
  return rows;
}

export function parseDoujinCartRowsFromPayload(
  doc: Document,
  payload: unknown,
): CartRow[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const data = record.data;
  if (!Array.isArray(data)) return [];
  return mapApiRows(doc, data as DoujinBasketItem[]);
}

export async function fetchDoujinCartRows(
  doc: Document,
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<CartRow[]> {
  const response = await fetchFn(BASKETS_URL, {
    credentials: "include",
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as unknown;
  return parseDoujinCartRowsFromPayload(doc, payload);
}
