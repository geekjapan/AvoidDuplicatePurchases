import type { InterventionSource } from "@adp/shared";

export interface CartRow {
  cid: string;
  title: string;
  maker: string | null;
  host: HTMLElement;
}

/** Live basket loading result; an empty array is a valid empty basket. */
export type CartCidLoadResult = string[] | { readonly status: "unavailable" };

export interface CartLookupItem {
  source: InterventionSource;
  cid: string;
  title: string;
  maker?: string;
}
