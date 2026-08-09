import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiContext } from "../http.js";

export type ApiHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
) => Promise<boolean>;

/**
 * Explicit read-only GET shapes plus the sole write-verb exception.
 * Unknown /api GET paths must 403 (not fall through to 404 handlers).
 */
const ALLOWED_GET_EXACT = new Set([
  "/api/listings",
  "/api/candidates",
  "/api/settings",
  "/api/sync-state/dlsite",
  "/api/sync-state/full_sync",
  "/api/sync-state/fanza_doujin",
  "/api/sync-state/fanza_books",
  "/api/sync-state/fanza_video",
  "/api/sync-state/fanza_dlsoft",
  // DOM library-sync sources: read-only state readout stays allowed.
  "/api/sync-state/amazon",
  "/api/sync-state/ebookjapan",
  "/api/sync-state/kobo",
]);

/**
 * API namespace includes the exact root `/api` as well as `/api/...`.
 * Percent-encoded separators (`%2F` / `%2f`) count as path separators so
 * variants like `/api%2F` cannot bypass the namespace gate to the SPA.
 * Exact `/api` must not fall through to the SPA static handler.
 */
export function isApiNamespace(pathname: string): boolean {
  // Node keeps %2F encoded in URL.pathname; normalize before prefix checks.
  const normalized = pathname.replace(/%2f/gi, "/");
  return normalized === "/api" || normalized.startsWith("/api/");
}

/** POST /api/lookup is the only write-verb route a read-only machine may call. */
function isReadAllowed(method: string, pathname: string): boolean {
  if (method === "POST" && pathname === "/api/lookup") return true;
  if (method === "GET" && ALLOWED_GET_EXACT.has(pathname)) return true;
  return false;
}

/**
 * Reject every non-allowlisted /api route with 403 before it reaches handlers.
 * Only known read-only GET shapes and POST /api/lookup stay allowed (spec §9).
 * Runs after the shared origin gate, matching the production pipeline.
 */
export function withReadonlyGuard(handle: ApiHandler): ApiHandler {
  return async (req, res, ctx) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${ctx.port}`);
    if (!isApiNamespace(url.pathname)) return handle(req, res, ctx);
    if (!isReadAllowed((req.method ?? "GET").toUpperCase(), url.pathname)) {
      const payload = JSON.stringify({ error: "forbidden" });
      res.writeHead(403, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      });
      res.end(payload);
      return true;
    }
    return handle(req, res, ctx);
  };
}
