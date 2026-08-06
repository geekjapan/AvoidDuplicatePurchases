import type { InterventionSource } from "@adp/shared";

export interface CartRow {
  cid: string;
  title: string;
  maker: string | null;
  host: HTMLElement;
}

export interface CartLookupItem {
  source: InterventionSource;
  cid: string;
  title: string;
  maker?: string;
}
