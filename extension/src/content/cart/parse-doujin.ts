import { z } from "zod";

import type { CartRow } from "./types.js";

const BASKETS_URL = "https://www.dmm.co.jp/dc/doujin/api/baskets/";

const NonBlankString = z.string().trim().min(1);

/** Strict local schema for FANZA Doujin basket API payload (cart trust boundary). */
const DoujinBasketItemSchema = z
  .object({
    content_id: NonBlankString.optional(),
    contentId: NonBlankString.optional(),
    title: z.string().optional(),
    maker_name: z.string().optional(),
    makerName: z.string().optional(),
  })
  .strict()
  .refine(
    (item) => Boolean(item.content_id ?? item.contentId),
    { message: "content_id or contentId required" },
  );

const DoujinBasketPayloadSchema = z
  .object({
    data: z.array(DoujinBasketItemSchema),
  })
  .strict();

function resolveCid(item: z.infer<typeof DoujinBasketItemSchema>): string | null {
  const cid = item.content_id ?? item.contentId;
  return cid && cid.trim() ? cid.trim() : null;
}

function findDoujinRowHost(doc: Document, cid: string): HTMLElement | null {
  const divs = doc.querySelectorAll<HTMLElement>("div");
  for (const candidate of Array.from(divs)) {
    if (
      candidate.getAttribute("data-content-id") === cid ||
      candidate.getAttribute("data-cid") === cid
    ) {
      return candidate;
    }
  }
  return null;
}

function mapApiRows(
  doc: Document,
  items: z.infer<typeof DoujinBasketItemSchema>[],
): CartRow[] {
  const rows: CartRow[] = [];
  for (const item of items) {
    const cid = resolveCid(item);
    if (!cid) continue;
    const host = findDoujinRowHost(doc, cid);
    // Only exact product-row hosts; never fall back to document.body.
    if (!host || host === doc.body) continue;
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
  const parsed = DoujinBasketPayloadSchema.safeParse(payload);
  if (!parsed.success) return [];
  try {
    return mapApiRows(doc, parsed.data.data);
  } catch {
    return [];
  }
}

export async function fetchDoujinCartRows(
  doc: Document,
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<CartRow[]> {
  try {
    const response = await fetchFn(BASKETS_URL, {
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
    return parseDoujinCartRowsFromPayload(doc, payload);
  } catch {
    // Network rejection or unexpected throw: silent empty (no banner / no rethrow).
    return [];
  }
}
