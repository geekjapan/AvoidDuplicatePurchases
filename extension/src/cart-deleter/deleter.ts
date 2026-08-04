import {
  buildDeleteRequests,
  buildRestoreRequests,
  type CartRequestContext,
  type CartSource,
} from "@adp/shared";

import { executeCartRequests } from "./executor.js";
import { isCartPage } from "./page-guard.js";
import type { CartDeleter, CartDeleterResult, FetchFn } from "./types.js";

export interface CreateCartDeleterOptions {
  source: CartSource;
  pathname: string;
  context: CartRequestContext;
  fetchFn?: FetchFn;
}

export function createCartDeleter(opts: CreateCartDeleterOptions): CartDeleter {
  const fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);

  return {
    source: opts.source,
    async remove(cids: string[]): Promise<CartDeleterResult> {
      if (!isCartPage(opts.source, opts.pathname) || cids.length === 0) {
        return { ok: [], failed: [...cids] };
      }
      const requests = buildDeleteRequests(opts.source, cids, opts.context);
      const ok: string[] = [];
      const failed: string[] = [];

      if (opts.source === "dlsite") {
        for (let i = 0; i < requests.length; i++) {
          const cid = cids[i]!;
          const success = await executeCartRequests([requests[i]!], fetchFn);
          if (success) ok.push(cid);
          else failed.push(cid);
        }
        return { ok, failed };
      }

      const success = await executeCartRequests(requests, fetchFn);
      return success ? { ok: [...cids], failed: [] } : { ok: [], failed: [...cids] };
    },
    async restore(cids: string[]): Promise<void> {
      if (!isCartPage(opts.source, opts.pathname) || cids.length === 0) return;
      const requests = buildRestoreRequests(opts.source, cids, opts.context);
      if (opts.source === "dlsite") {
        for (const req of requests) {
          await executeCartRequests([req], fetchFn);
        }
        return;
      }
      await executeCartRequests(requests, fetchFn);
    },
  };
}
