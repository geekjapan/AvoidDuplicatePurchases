import type { CartRequest } from "@adp/shared";

import type { FetchFn } from "./types.js";

export async function executeCartRequests(
  requests: CartRequest[],
  fetchFn: FetchFn = globalThis.fetch.bind(globalThis),
): Promise<boolean> {
  for (const req of requests) {
    const init: RequestInit = {
      method: req.method,
      credentials: "include",
      headers: req.headers,
    };
    if (req.body !== undefined) {
      init.body = req.body;
    }
    const response = await fetchFn(req.url, init);
    if (!response.ok) return false;
  }
  return true;
}
