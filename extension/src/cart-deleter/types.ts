import type { CartSource } from "@adp/shared";

export interface CartDeleterResult {
  ok: string[];
  failed: string[];
}

export interface CartDeleter {
  readonly source: CartSource;
  remove(cids: string[]): Promise<CartDeleterResult>;
  restore(cids: string[]): Promise<void>;
}

export type FetchFn = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
