import type { CartRequest } from "@adp/shared";

import type { FetchFn } from "./types.js";

/**
 * Execute cart mutation requests sequentially.
 * Fetch rejections and unexpected throws are absorbed → false (never rethrow).
 * Non-ok HTTP also yields false. Callers must not treat false as success.
 */
export async function executeCartRequests(
  requests: CartRequest[],
  fetchFn: FetchFn = globalThis.fetch.bind(globalThis),
): Promise<boolean> {
  try {
    for (const req of requests) {
      const init: RequestInit = {
        method: req.method,
        credentials: "include",
        headers: req.headers,
      };
      if (req.body !== undefined) {
        init.body = req.body;
      }
      let response: Response;
      try {
        response = await fetchFn(req.url, init);
      } catch {
        return false;
      }
      if (!response.ok) return false;
    }
    return true;
  } catch {
    return false;
  }
}
