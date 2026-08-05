import {
  buildDeleteRequests,
  buildRestoreRequests,
  type CartRequestContext,
  type CartSource,
} from "@adp/shared";

import { encodeDlsiteWorknoForUrl } from "../content/cart/dlsite-workno.js";
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
      const ok: string[] = [];
      const failed: string[] = [];

      if (opts.source === "dlsite") {
        for (const cid of cids) {
          // Validate + encode before authenticated delete URL (fetch 0 if invalid).
          const safe = encodeDlsiteWorknoForUrl(cid);
          if (!safe) {
            failed.push(cid);
            continue;
          }
          const requests = buildDeleteRequests(opts.source, [safe], context);
          const success = await executeCartRequests(requests, fetchFn);
          if (success) ok.push(cid);
          else failed.push(cid);
        }
        return { ok, failed };
      }

      const requests = buildDeleteRequests(opts.source, cids, context);
      const success = await executeCartRequests(requests, fetchFn);
      return success ? { ok: [...cids], failed: [] } : { ok: [], failed: [...cids] };
    },
    async restore(cids: string[]): Promise<void> {
      if (cids.length === 0) return;
      const context = readLiveMutationState(opts.source, opts.doc);
      if (!context) return;

      if (opts.source === "dlsite") {
        for (const cid of cids) {
          const safe = encodeDlsiteWorknoForUrl(cid);
          if (!safe) continue;
          const requests = buildRestoreRequests(opts.source, [safe], context);
          await executeCartRequests(requests, fetchFn);
        }
        return;
      }

      const requests = buildRestoreRequests(opts.source, cids, context);
      await executeCartRequests(requests, fetchFn);
    },
  };
}
