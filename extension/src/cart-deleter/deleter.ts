import {
  buildDeleteRequests,
  buildRestoreRequests,
  type CartRequestContext,
  type CartSource,
} from "@adp/shared";

import { readCartContext } from "./context.js";
import { executeCartRequests } from "./executor.js";
import { isCartPage } from "./page-guard.js";
import type { CartDeleter, CartDeleterResult, FetchFn } from "./types.js";

export interface CreateCartDeleterOptions {
  source: CartSource;
  /** Live document; pathname and page-context values are re-read on every remove/restore. */
  doc: Document;
  fetchFn?: FetchFn;
}

function readLivePathname(doc: Document): string {
  const loc = doc.location;
  if (loc?.pathname) return loc.pathname;
  if (loc?.href) {
    try {
      return new URL(loc.href).pathname;
    } catch {
      return "";
    }
  }
  return "";
}

/**
 * Re-read cart page guard + page-context at invocation time.
 * Never uses boot-captured pathname / csrf token / own_url.
 */
function readLiveMutationState(
  source: CartSource,
  doc: Document,
): CartRequestContext | null {
  const pathname = readLivePathname(doc);
  if (!isCartPage(source, pathname)) return null;
  try {
    return readCartContext(source, doc);
  } catch {
    return null;
  }
}

export function createCartDeleter(opts: CreateCartDeleterOptions): CartDeleter {
  const fetchFn = opts.fetchFn ?? globalThis.fetch.bind(globalThis);

  return {
    source: opts.source,
    async remove(cids: string[]): Promise<CartDeleterResult> {
      if (cids.length === 0) return { ok: [], failed: [] };
      const context = readLiveMutationState(opts.source, opts.doc);
      if (!context) {
        return { ok: [], failed: [...cids] };
      }
      const requests = buildDeleteRequests(opts.source, cids, context);
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
      if (cids.length === 0) return;
      const context = readLiveMutationState(opts.source, opts.doc);
      if (!context) return;
      const requests = buildRestoreRequests(opts.source, cids, context);
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
