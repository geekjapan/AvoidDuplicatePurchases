import type { InterventionSource, Money } from "@adp/shared";

export interface CartRow {
  cid: string;
  title: string;
  maker: string | null;
  host: HTMLElement;
  /** Current visible/basket price when the store exposes one on the cart row. */
  finalPrice?: Money | null;
}

/**
 * Live basket item for lookup when DOM product-row hosts are absent.
 * title/maker come from the basket API (FANZA Doujin) when available.
 */
export interface CartLoadedItem {
  cid: string;
  title?: string;
  maker?: string | null;
  /** Store-reported current basket price fallback (never inferred from regular price). */
  finalPrice?: Money | null;
}

/**
 * Live basket loading result; an empty array is a valid empty basket.
 *
 * - string[]: cid-only loaders (FANZA Books / tests / legacy)
 * - CartLoadedItem[]: cid + optional title/maker (FANZA Doujin baskets API)
 * - {status:"unavailable"}: fail-open (do not treat as empty cart)
 */
export type CartCidLoadResult =
  | Array<string | CartLoadedItem>
  | { readonly status: "unavailable" };

export interface CartLookupItem {
  source: InterventionSource;
  cid: string;
  title: string;
  maker?: string;
}

/** Normalize cid-only strings and rich items into a single shape for lookup. */
export function normalizeCartCidLoad(
  loaded: Array<string | CartLoadedItem>,
): CartLoadedItem[] {
  const out: CartLoadedItem[] = [];
  for (const item of loaded) {
    if (typeof item === "string") {
      const cid = item.trim();
      if (cid) out.push({ cid });
      continue;
    }
    const cid = typeof item.cid === "string" ? item.cid.trim() : "";
    if (!cid) continue;
    const title =
      typeof item.title === "string" && item.title.trim()
        ? item.title.trim()
        : undefined;
    const makerRaw = item.maker;
    const maker =
      typeof makerRaw === "string" && makerRaw.trim()
        ? makerRaw.trim()
        : makerRaw === null
          ? null
          : undefined;
    out.push({
      cid,
      title,
      maker,
      ...(item.finalPrice ? { finalPrice: item.finalPrice } : {}),
    });
  }
  return out;
}
