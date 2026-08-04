import { z } from "zod";

import type { CartRow } from "./types.js";

const BASKETS_URL = "https://www.dmm.co.jp/dc/doujin/api/baskets/";

const NonBlankString = z.string().trim().min(1);

/**
 * Strict local schema for FANZA Doujin basket API payload (cart trust boundary).
 * Top-level + item keys are limited to fields documented in prototype/fanza/README.md
 * (canonical GET /dc/doujin/api/baskets/ response) plus documented content/title/maker
 * camelCase variants. Truly unknown keys fail safeParse → silent empty rows.
 */
const DoujinBasketItemSchema = z
  .object({
    // Content id variants (snake_case from basket API; camelCase from mylibrary docs).
    content_id: NonBlankString.optional(),
    contentId: NonBlankString.optional(),
    product_id: z.string().optional(),
    productId: z.string().optional(),
    title: z.string().optional(),
    maker_name: z.string().optional(),
    makerName: z.string().optional(),
    image_src: z.string().optional(),
    imageSrc: z.string().optional(),
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
    (item) => {
      const cid = item.content_id ?? item.contentId ?? item.product_id ?? item.productId;
      return Boolean(cid && cid.trim());
    },
    { message: "non-blank content_id/contentId/product_id/productId required" },
  );

const DoujinBasketPayloadSchema = z
  .object({
    error_code: z.union([z.string(), z.number()]).optional(),
    error_message: z.array(z.unknown()).optional(),
    data: z.array(DoujinBasketItemSchema),
  })
  .strict();

function resolveCid(item: z.infer<typeof DoujinBasketItemSchema>): string | null {
  const cid =
    item.content_id ?? item.contentId ?? item.product_id ?? item.productId;
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
