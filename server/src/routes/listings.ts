import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError } from "zod";
import {
  ListingsQuerySchema,
  ListingsResponseSchema,
  ListingSchema,
  makerMatchKey,
  type Source,
} from "@adp/shared";
import { registerApiRouteMount } from "../route-mounts.js";
import type { ApiContext } from "../http.js";
import { listingDisplayMetadata } from "../services/listing-display.js";

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function parseZod<T>(schema: { parse: (v: unknown) => T }, value: unknown): T | null {
  try {
    return schema.parse(value);
  } catch (err) {
    if (err instanceof ZodError) return null;
    throw err;
  }
}

interface ListingRow {
  id: number;
  source: Source;
  cid: string;
  work_id: number;
  work_id_locked: number;
  title: string;
  maker_name: string | null;
  series_id: string | null;
  image_url: string | null;
  purchased_at: string | null;
  purchased_at_precision: "second" | "day" | "unknown";
  raw_json: string;
}

function rowToListing(row: ListingRow) {
  const display = listingDisplayMetadata({
    source: row.source,
    cid: row.cid,
    seriesId: row.series_id,
    imageUrl: row.image_url,
    rawJson: row.raw_json,
  });
  return ListingSchema.parse({
    id: row.id,
    source: row.source,
    cid: row.cid,
    workId: row.work_id,
    workIdLocked: row.work_id_locked === 1,
    title: row.title,
    maker: row.maker_name,
    seriesId: row.series_id,
    ...display,
    purchasedAt: row.purchased_at,
    purchasedAtPrecision: row.purchased_at_precision,
    purchasePrice: null,
    currentPrice: null,
  });
}

function matchesQuery(row: ListingRow, q: string | undefined, maker: string | undefined): boolean {
  if (maker !== undefined) {
    const filterKey = makerMatchKey(maker);
    const rowKey = makerMatchKey(row.maker_name);
    if (!filterKey || rowKey !== filterKey) return false;
  }
  if (q === undefined || q.trim() === "") return true;
  const needle = q.trim().toLowerCase();
  const hay = `${row.title}\n${row.maker_name ?? ""}\n${row.source}\n${row.cid}`.toLowerCase();
  return hay.includes(needle);
}

async function handleListingsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
  url: URL,
): Promise<boolean> {
  if (req.method !== "GET" || url.pathname !== "/api/listings") return false;

  const query = parseZod(ListingsQuerySchema, {
    q: url.searchParams.get("q") ?? undefined,
    source: url.searchParams.get("source") ?? undefined,
    maker: url.searchParams.get("maker") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  });
  if (!query) {
    json(res, 400, { error: "invalid_request" });
    return true;
  }

  const rows = ctx.db
    .prepare(
      `SELECT id, source, cid, work_id, work_id_locked, title, maker_name, series_id, image_url,
              purchased_at, purchased_at_precision, raw_json
       FROM listing
       ORDER BY work_id, id`,
    )
    .all() as unknown as ListingRow[];

  let filtered = rows.filter((row) => {
    if (query.source && row.source !== query.source) return false;
    return matchesQuery(row, query.q, query.maker);
  });

  const total = filtered.length;
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 500;
  filtered = filtered.slice(offset, offset + limit);

  json(
    res,
    200,
    ListingsResponseSchema.parse({
      listings: filtered.map(rowToListing),
      total,
    }),
  );
  return true;
}

/** Register GET /api/listings (T-ADMIN-CORE). */
export function registerListingsRoutes(): void {
  registerApiRouteMount(handleListingsRoute);
}

registerListingsRoutes();
