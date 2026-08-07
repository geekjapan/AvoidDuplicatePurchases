import type { InterventionSource } from "@adp/shared";

export interface LookupOtherHit {
  source: string;
  cid: string;
  title: string;
  url: string;
}

export interface LookupHit {
  owned: boolean;
  /** Present when same-store owned and listing.purchased_at is available. */
  purchasedAt?: string | null;
  other: LookupOtherHit[];
  /** Fuzzy same-maker candidates; never treated as purchased. */
  possible?: LookupOtherHit[];
}

export interface PageIdentity {
  source: InterventionSource;
  cid: string;
}

export interface ProductMeta extends PageIdentity {
  title: string;
  maker: string | null;
}

export interface ListingItem extends PageIdentity {
  anchor: Element;
}
