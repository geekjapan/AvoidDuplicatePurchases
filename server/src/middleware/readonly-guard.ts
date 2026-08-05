import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiContext } from "../http.js";

export type ApiHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
) => Promise<boolean>;

/** POST /api/lookup is the only write-verb route a read-only machine may call. */
function isReadAllowed(method: string, pathname: string): boolean {
  return method === "GET" || (method === "POST" && pathname === "/api/lookup");
}

/**
 * Reject every /api write route with 403 before it reaches handlers.
 * GET routes and POST /api/lookup stay allowed (spec §9 read-only mode).
 * Runs after the shared origin gate, matching the production pipeline.
 */
export function withReadonlyGuard(handle: ApiHandler): ApiHandler {
  return async (req, res, ctx) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${ctx.port}`);
    if (!url.pathname.startsWith("/api/")) return handle(req, res, ctx);
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
