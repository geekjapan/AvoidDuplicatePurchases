import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError, z } from "zod";
import {
  LIBRARY_SOURCES,
  LibraryImportRequestSchema,
  LibraryImportResponseSchema,
  SyncStateResponseSchema,
} from "@adp/shared";
import { registerApiRouteMount } from "../route-mounts.js";
import type { ApiContext } from "../http.js";
import { importLibraryBatch } from "../import/library/index.js";
import { getSyncState, markSourceSynced } from "../import/fanza/common.js";

const MarkSyncedRequestSchema = z.object({}).strict();

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function validationError(res: ServerResponse): void {
  json(res, 400, { error: "invalid_request" });
}

function parseZod<T>(schema: { parse: (v: unknown) => T }, value: unknown): T | null {
  try {
    return schema.parse(value);
  } catch (err) {
    if (err instanceof ZodError) return null;
    throw err;
  }
}

function isLibrarySource(source: string): boolean {
  return (LIBRARY_SOURCES as readonly string[]).includes(source);
}

/**
 * Generic DOM library-sync endpoints (amazon / ebookjapan / kobo):
 * `POST /api/import/library` (bounded visible batch), plus sync-state
 * read/mark for the three library sources. The import records every visible
 * observation and maps only `purchased` to the idempotent listing path.
 */
async function handleLibraryRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
  url: URL,
): Promise<boolean> {
  const method = req.method ?? "GET";

  if (method === "POST" && url.pathname === "/api/import/library") {
    const raw = await readBody(req);
    let body: unknown;
    try {
      body = raw.length ? JSON.parse(raw) : null;
    } catch {
      validationError(res);
      return true;
    }
    const parsed = parseZod(LibraryImportRequestSchema, body);
    if (!parsed) {
      validationError(res);
      return true;
    }
    try {
      const counts = importLibraryBatch(ctx.db, parsed.source, parsed.pageUrl, parsed.items);
      json(res, 200, LibraryImportResponseSchema.parse(counts));
    } catch {
      validationError(res);
    }
    return true;
  }

  const syncMatch = url.pathname.match(/^\/api\/sync-state\/([^/]+)$/);
  if (syncMatch) {
    const sourceParam = syncMatch[1]!;
    if (!isLibrarySource(sourceParam)) return false;

    if (method === "GET") {
      const state = getSyncState(ctx.db, sourceParam);
      json(res, 200, SyncStateResponseSchema.parse(state));
      return true;
    }

    if (method === "POST") {
      const raw = await readBody(req);
      let body: unknown;
      try {
        body = raw.length ? JSON.parse(raw) : {};
      } catch {
        validationError(res);
        return true;
      }
      const parsed = parseZod(MarkSyncedRequestSchema, body);
      if (!parsed) {
        validationError(res);
        return true;
      }
      markSourceSynced(ctx.db, sourceParam);
      const state = getSyncState(ctx.db, sourceParam);
      json(res, 200, SyncStateResponseSchema.parse(state));
      return true;
    }
  }

  return false;
}

registerApiRouteMount(handleLibraryRoute);
