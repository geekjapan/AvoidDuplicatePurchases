import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError, z } from "zod";
import {
  ImportRequestSchema,
  ImportResponseSchema,
  SyncStateResponseSchema,
} from "@adp/shared";
import { registerApiRouteMount } from "../../route-mounts.js";
import type { ApiContext } from "../../http.js";
import { importFanzaDoujinPayload } from "./doujin.js";
import { importFanzaBooksPayload } from "./books.js";
import { importFanzaVideoPayload } from "./video.js";
import { importFanzaDlsoftPayload } from "./dlsoft.js";
import { getSyncState, markSourceSynced } from "./common.js";

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

type FanzaSource = "fanza_doujin" | "fanza_books" | "fanza_video" | "fanza_dlsoft";

const FANZA_SOURCES: readonly FanzaSource[] = [
  "fanza_doujin",
  "fanza_books",
  "fanza_video",
  "fanza_dlsoft",
];

function isFanzaSource(source: string): source is FanzaSource {
  return (FANZA_SOURCES as readonly string[]).includes(source);
}

function importPayload(db: ApiContext["db"], source: FanzaSource, raw: unknown) {
  switch (source) {
    case "fanza_doujin":
      return importFanzaDoujinPayload(db, raw);
    case "fanza_books":
      return importFanzaBooksPayload(db, raw);
    case "fanza_video":
      return importFanzaVideoPayload(db, raw);
    case "fanza_dlsoft":
      return importFanzaDlsoftPayload(db, raw);
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

async function handleFanzaRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
  url: URL,
): Promise<boolean> {
  const method = req.method ?? "GET";
  const importMatch = url.pathname.match(/^\/api\/import\/([^/]+)$/);
  if (method === "POST" && importMatch) {
    const sourceParam = importMatch[1]!;
    if (!isFanzaSource(sourceParam)) return false;

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
      const counts = importPayload(ctx.db, sourceParam, parsed);
      json(res, 200, ImportResponseSchema.passthrough().parse(counts));
    } catch {
      validationError(res);
    }
    return true;
  }

  const syncMatch = url.pathname.match(/^\/api\/sync-state\/([^/]+)$/);
  if (syncMatch) {
    const sourceParam = syncMatch[1]!;
    if (!isFanzaSource(sourceParam)) return false;

    if (method === "GET") {
      const state = getSyncState(ctx.db, sourceParam);
      json(res, 200, SyncStateResponseSchema.passthrough().parse(state));
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
      json(res, 200, SyncStateResponseSchema.passthrough().parse(state));
      return true;
    }
  }

  return false;
}

/** Register FANZA import + sync-state route mounts (T-FANZA). */
export function registerFanzaImportRoutes(): void {
  registerApiRouteMount(handleFanzaRoute);
}
