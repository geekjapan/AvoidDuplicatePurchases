import { z } from "zod";
import type { Money } from "@adp/shared";

import type { CartCidLoadResult, CartRow } from "./types.js";
import { readCartFinalPrice } from "./final-price.js";

const BASKETS_URL = "https://www.dmm.co.jp/dc/doujin/api/baskets/";

const NonBlankString = z.string().trim().min(1);

/**
 * Basket-only schema for FANZA Doujin cart API
 * (prototype/fanza/README.md GET /dc/doujin/api/baskets/).
 *
 * - content_id is required (trimmed non-blank).
 * - mylibrary camelCase contentId/productId-only shapes are rejected.
 * - product_id, when present, must be non-blank and equal to content_id.
 * - blank secondary product_id rejects the item.
 * - error_code accepts only canonical success string "0" (numeric 0 rejected).
 * - Unknown *extra* keys are stripped (live basket items grow fields; README
 *   documents trailing ellipsis). Wrong types / wrong shapes still fail closed
 *   → silent empty / unavailable. Root cause of #57 cart-gate miss: `.strict()`
 *   treated evolving basket JSON as unusable and fail-opened purchase.
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
  .refine(
    (item) => item.product_id === undefined || item.product_id === item.content_id,
    { message: "product_id must match content_id when present" },
  );

const DoujinBasketPayloadSchema = z.object({
  // Canonical success only: string "0". Numeric 0 / other codes rejected.
  error_code: z.literal("0").optional(),
  error_message: z.array(z.unknown()).optional(),
  data: z.array(DoujinBasketItemSchema),
});

function apiFinalPrice(item: z.infer<typeof DoujinBasketItemSchema>): Money | null {
  const amount = item.basket_price ?? item.price;
  if (amount === undefined || !Number.isSafeInteger(amount) || amount < 0) return null;
  return { amountMinor: amount, currency: "JPY", taxStatus: "unknown" };
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
    const cid = item.content_id;
    const host = findDoujinRowHost(doc, cid);
    // Only exact product-row hosts; never fall back to document.body.
    if (!host || host === doc.body) continue;
    const finalPrice = readCartFinalPrice("fanza_doujin", host, apiFinalPrice(item));
    rows.push({
      cid,
      title: item.title?.trim() || cid,
      maker: item.maker_name?.trim() || null,
      host,
      ...(finalPrice ? { finalPrice } : {}),
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

/**
 * Live basket items without DOM host matching.
 * Preserves content_id + title + maker_name for cross-store lookup when React
 * product-row hosts (data-content-id / data-cid) are absent.
 * Used by cart gate and purchase-progression pages.
 */
export function parseDoujinCartCidsFromPayload(
  payload: unknown,
): CartCidLoadResult {
  const parsed = DoujinBasketPayloadSchema.safeParse(payload);
  if (!parsed.success) return { status: "unavailable" };
  return parsed.data.data.map((item) => {
    const cid = item.content_id;
    const title = item.title?.trim() || undefined;
    const maker = item.maker_name?.trim() || null;
    const finalPrice = apiFinalPrice(item);
    return {
      cid,
      // Keep API title when present; callers fall back to cid for lookup title.
      ...(title ? { title } : {}),
      maker,
      ...(finalPrice ? { finalPrice } : {}),
    };
  });
}

export async function fetchDoujinCartCids(
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<CartCidLoadResult> {
  try {
    const response = await fetchFn(BASKETS_URL, {
      credentials: "include",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    if (!response.ok) return { status: "unavailable" };
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { status: "unavailable" };
    }
    return parseDoujinCartCidsFromPayload(payload);
  } catch {
    return { status: "unavailable" };
  }
}
