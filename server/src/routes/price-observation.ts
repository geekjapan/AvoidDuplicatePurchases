import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError } from "zod";
import {
  PriceObservationRequestSchema,
  PriceObservationResponseSchema,
} from "@adp/shared";
import { registerApiRouteMount } from "../route-mounts.js";
import type { ApiContext } from "../http.js";
import { upsertPriceObservation } from "../services/price-observation.js";

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

async function handlePriceObservationRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
  url: URL,
): Promise<boolean> {
  if (req.method !== "POST" || url.pathname !== "/api/listings/price-observation") {
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

  const parsed = parseZod(PriceObservationRequestSchema, body);
  if (!parsed) {
    json(res, 400, { error: "invalid_request" });
    return true;
  }

  const result = upsertPriceObservation(ctx.db, parsed);
  if (!result.ok) {
    if (result.error === "not_found") {
      json(res, 404, { error: "listing_not_found" });
      return true;
    }
    json(res, 400, { error: result.error });
    return true;
  }

  json(
    res,
    200,
    PriceObservationResponseSchema.parse({
      ok: true,
      priceObservation: result.priceObservation,
    }),
  );
  return true;
}

/** Register POST /api/listings/price-observation (issue #45). */
export function registerPriceObservationRoutes(): void {
  registerApiRouteMount(handlePriceObservationRoute);
}

registerPriceObservationRoutes();
