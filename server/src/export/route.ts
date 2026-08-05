import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError } from "zod";
import { ExportRequestSchema, ExportResponseSchema } from "@adp/shared";
import { registerApiRouteMount } from "../route-mounts.js";
import type { ApiContext } from "../http.js";
import { loadAdminSettings } from "../routes/settings.js";
import { exportSnapshot } from "./export.js";

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

function parseZod<T>(schema: { parse: (v: unknown) => T }, value: unknown): T | null {
  try {
    return schema.parse(value);
  } catch (err) {
    if (err instanceof ZodError) return null;
    throw err;
  }
}

async function handleExportRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
  url: URL,
): Promise<boolean> {
  if (url.pathname !== "/api/export") return false;
  if ((req.method ?? "GET") !== "POST") return false;

  const raw = await readBody(req);
  let body: unknown;
  try {
    body = raw.length ? JSON.parse(raw) : null;
  } catch {
    json(res, 400, { error: "invalid_request" });
    return true;
  }
  const parsed = parseZod(ExportRequestSchema, body);
  if (!parsed) {
    json(res, 400, { error: "invalid_request" });
    return true;
  }

  // Manual export targets the configured sync folder only (spec §8/§9).
  // The request destination must match it, so a local caller cannot point
  // VACUUM INTO at arbitrary paths.
  const configured = loadAdminSettings(ctx.db, ctx.port).exportDestination.trim();
  if (!configured || configured !== parsed.destination.trim()) {
    json(res, 400, { error: "invalid_request" });
    return true;
  }

  try {
    const result = exportSnapshot(ctx.db, configured);
    json(res, 200, ExportResponseSchema.parse(result));
  } catch {
    // No internal path/stack in error bodies (spec §7).
    json(res, 500, { error: "internal_error" });
  }
  return true;
}

/** Register POST /api/export (T-EXPORT). */
export function registerExportRoutes(): void {
  registerApiRouteMount(handleExportRoute);
}

registerExportRoutes();
