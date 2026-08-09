import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError } from "zod";
import {
  RelatedImportRequestSchema,
  RelatedImportResponseSchema,
  RelatedProductsQuerySchema,
  RelatedProductsResponseSchema,
} from "@adp/shared";
import { registerApiRouteMount } from "../route-mounts.js";
import type { ApiContext } from "../http.js";
import {
  getRelatedProducts,
  importRelatedProducts,
} from "../services/related-products.js";

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

function queryObject(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    out[key] = value;
  }
  return out;
}

async function handleRelatedProductsGet(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
  url: URL,
): Promise<boolean> {
  if (req.method !== "GET" || url.pathname !== "/api/related-products") {
    return false;
  }

  const parsed = parseZod(RelatedProductsQuerySchema, queryObject(url));
  if (!parsed) {
    json(res, 400, { error: "invalid_request" });
    return true;
  }

  const result = getRelatedProducts(ctx.db, parsed);
  if (!result.ok) {
    json(res, 404, { error: "not_found" });
    return true;
  }

  json(res, 200, RelatedProductsResponseSchema.parse(result.response));
  return true;
}

async function handleRelatedImport(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
  url: URL,
): Promise<boolean> {
  if (req.method !== "POST" || url.pathname !== "/api/import/related") {
    return false;
  }

  const raw = await readBody(req);
  let body: unknown;
  try {
    body = raw.length ? JSON.parse(raw) : null;
  } catch {
    json(res, 400, { error: "invalid_request" });
    return true;
  }

  const parsed = parseZod(RelatedImportRequestSchema, body);
  if (!parsed) {
    json(res, 400, { error: "invalid_request" });
    return true;
  }

  const result = importRelatedProducts(ctx.db, parsed);
  if (!result.ok) {
    if (result.error === "not_found") {
      json(res, 404, { error: "not_found" });
      return true;
    }
    json(res, 400, { error: "invalid_request" });
    return true;
  }

  json(res, 200, RelatedImportResponseSchema.parse(result.result));
  return true;
}

async function handleRelatedRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
  url: URL,
): Promise<boolean> {
  if (await handleRelatedProductsGet(req, res, ctx, url)) return true;
  if (await handleRelatedImport(req, res, ctx, url)) return true;
  return false;
}

/** Register GET /api/related-products and POST /api/import/related (issue #47). */
export function registerRelatedProductsRoutes(): void {
  registerApiRouteMount(handleRelatedRoutes);
}

registerRelatedProductsRoutes();
