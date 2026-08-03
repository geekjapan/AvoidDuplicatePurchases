import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError, z } from "zod";
import {
  LookupRequestSchema,
  LookupResponseSchema,
  ImportRequestSchema,
  ImportResponseSchema,
  SyncStateResponseSchema,
  RematchRequestSchema,
  RematchResponseSchema,
  SourcePathSchema,
} from "@adp/shared";
import type { DatabaseSync } from "node:sqlite";
import { isAllowedOrigin } from "./config.js";
import { lookupItems } from "./services/lookup.js";
import {
  importDlsitePayload,
  getSyncState,
  commitDlsiteCursor,
  type ProductFetcher,
} from "./services/import.js";
import { runRematch } from "./services/lookup.js";
import { dispatchRouteMounts } from "./route-mounts.js";
import "./import/fanza/index.js";

export interface ApiContext {
  db: DatabaseSync;
  port: number;
  /** Exact chrome-extension:// origins allowed (from ADP_EXTENSION_ORIGIN). */
  extensionOrigins?: ReadonlySet<string>;
  productFetcher?: ProductFetcher;
}

/** Optional multi-chunk flag on `{ items, advanceCursor? }` import bodies. */
const ImportAdvanceFlagSchema = z
  .object({
    advanceCursor: z.boolean().optional(),
  })
  .passthrough();

const CommitCursorRequestSchema = z
  .object({
    cursor: z.string().min(1),
  })
  .strict();

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

function forbidden(res: ServerResponse): void {
  json(res, 403, { error: "forbidden" });
}

function notFound(res: ServerResponse): void {
  json(res, 404, { error: "not_found" });
}

function parseZod<T>(schema: { parse: (v: unknown) => T }, value: unknown): T | null {
  try {
    return schema.parse(value);
  } catch (err) {
    if (err instanceof ZodError) return null;
    throw err;
  }
}

/** Resolve whether this import batch should advance sync_state.cursor. */
function resolveAdvanceCursor(body: unknown): boolean {
  if (Array.isArray(body)) return true;
  if (body && typeof body === "object") {
    const flagged = ImportAdvanceFlagSchema.safeParse(body);
    if (flagged.success && flagged.data.advanceCursor === false) return false;
  }
  return true;
}

export async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${ctx.port}`);
  if (!url.pathname.startsWith("/api/")) return false;

  if (!isAllowedOrigin(req.headers.origin, ctx.port, ctx.extensionOrigins ?? new Set())) {
    forbidden(res);
    return true;
  }

  const method = req.method ?? "GET";

  if (method === "POST" && url.pathname === "/api/lookup") {
    const raw = await readBody(req);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      validationError(res);
      return true;
    }
    const parsed = parseZod(LookupRequestSchema, body);
    if (!parsed) {
      validationError(res);
      return true;
    }
    const results = lookupItems(ctx.db, parsed.items);
    const response = LookupResponseSchema.parse({ results });
    json(res, 200, response);
    return true;
  }

  if (method === "POST" && url.pathname === "/api/import/dlsite") {
    const raw = await readBody(req);
    let body: unknown;
    try {
      body = raw.length ? JSON.parse(raw) : null;
    } catch {
      validationError(res);
      return true;
    }
    const parsed = parseZod(ImportRequestSchema, body);
    if (!parsed) {
      validationError(res);
      return true;
    }
    try {
      const counts = await importDlsitePayload(
        ctx.db,
        parsed,
        ctx.productFetcher,
        undefined,
        { advanceCursor: resolveAdvanceCursor(parsed) },
      );
      json(res, 200, ImportResponseSchema.parse(counts));
    } catch {
      validationError(res);
    }
    return true;
  }

  if (method === "GET" && url.pathname === "/api/sync-state/dlsite") {
    const state = getSyncState(ctx.db, "dlsite");
    json(res, 200, SyncStateResponseSchema.parse(state));
    return true;
  }

  // Commit DLsite last= cursor after a multi-chunk sync fully succeeds.
  if (method === "POST" && url.pathname === "/api/sync-state/dlsite") {
    const raw = await readBody(req);
    let body: unknown;
    try {
      body = raw.length ? JSON.parse(raw) : null;
    } catch {
      validationError(res);
      return true;
    }
    const parsed = parseZod(CommitCursorRequestSchema, body);
    if (!parsed) {
      validationError(res);
      return true;
    }
    try {
      commitDlsiteCursor(ctx.db, parsed.cursor);
      const state = getSyncState(ctx.db, "dlsite");
      json(res, 200, SyncStateResponseSchema.parse(state));
    } catch {
      validationError(res);
    }
    return true;
  }

  if (method === "POST" && url.pathname === "/api/rematch") {
    const raw = await readBody(req);
    let body: unknown;
    try {
      // Empty body is treated as {}; invalid JSON and extra fields are 400.
      body = raw.length ? JSON.parse(raw) : {};
    } catch {
      validationError(res);
      return true;
    }
    const parsed = parseZod(RematchRequestSchema, body);
    if (!parsed) {
      validationError(res);
      return true;
    }
    const result = runRematch(ctx.db);
    json(res, 200, RematchResponseSchema.parse(result));
    return true;
  }

  const importMatch = url.pathname.match(/^\/api\/import\/([^/]+)$/);
  if (method === "POST" && importMatch) {
    const source = parseZod(SourcePathSchema, { source: importMatch[1] });
    if (!source) {
      validationError(res);
      return true;
    }
    if (source.source !== "dlsite") {
      if (await dispatchRouteMounts(req, res, ctx, url)) return true;
    }
    notFound(res);
    return true;
  }

  const syncMatch = url.pathname.match(/^\/api\/sync-state\/([^/]+)$/);
  if (syncMatch) {
    const source = parseZod(SourcePathSchema, { source: syncMatch[1] });
    if (!source) {
      validationError(res);
      return true;
    }
    if (source.source !== "dlsite") {
      if (await dispatchRouteMounts(req, res, ctx, url)) return true;
    }
    notFound(res);
    return true;
  }

  if (await dispatchRouteMounts(req, res, ctx, url)) {
    return true;
  }

  notFound(res);
  return true;
}
