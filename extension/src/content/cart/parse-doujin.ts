import { z } from "zod";

import type { CartRow } from "./types.js";

const BASKETS_URL = "https://www.dmm.co.jp/dc/doujin/api/baskets/";

const NonBlankString = z.string().trim().min(1);

/**
 * Basket-only canonical schema for FANZA Doujin cart API
 * (prototype/fanza/README.md GET /dc/doujin/api/baskets/).
 *
 * - content_id is required (trimmed non-blank).
 * - mylibrary camelCase contentId/productId-only shapes are rejected.
 * - product_id, when present, must be non-blank and equal to content_id.
 * - blank secondary fields reject the whole item (and thus the payload).
 * - error_code accepts only canonical success string "0" (numeric 0 rejected).
 * - unknown keys / wrong types fail closed → silent empty rows.
 */
const DoujinBasketItemSchema = z
  .object({
    content_id: NonBlankString,
    product_id: NonBlankString.optional(),
    title: z.string().optional(),
    maker_name: z.string().optional(),
    image_src: z.string().optional(),
    price: z.number().optional(),
    fixed_price: z.number().optional(),
    basket_price: z.number().optional(),
    genre: z.string().optional(),
    section: z.string().optional(),
    // Opaque nested objects documented as `{…}` on the basket item.
    campaign_info: z.record(z.string(), z.unknown()).optional(),
    coupon_info: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .refine(
    (item) => item.product_id === undefined || item.product_id === item.content_id,
    { message: "product_id must match content_id when present" },
  );

const DoujinBasketPayloadSchema = z
  .object({
    // Canonical success only: string "0". Numeric 0 / other codes rejected.
    error_code: z.literal("0").optional(),
    error_message: z.array(z.unknown()).optional(),
    data: z.array(DoujinBasketItemSchema),
  })
  .strict();

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
    const cid = item.content_id;
    const host = findDoujinRowHost(doc, cid);
    // Only exact product-row hosts; never fall back to document.body.
    if (!host || host === doc.body) continue;
    rows.push({
      cid,
      title: item.title?.trim() || cid,
      maker: item.maker_name?.trim() || null,
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
