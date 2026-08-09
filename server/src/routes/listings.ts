import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError } from "zod";
import {
  ListingsQuerySchema,
  ListingsResponseSchema,
  ListingSchema,
  makerMatchKey,
  type ListingsQuery,
  type PriceObservation,
  type Source,
} from "@adp/shared";
import { registerApiRouteMount } from "../route-mounts.js";
import type { ApiContext } from "../http.js";
import { listingDisplayMetadata } from "../services/listing-display.js";
import { loadPriceObservationsByListingIds } from "../services/price-observation.js";

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

type PriceTier = "regular" | "sale" | "coupon";

function rowToListing(
  row: ListingRow,
  priceObservation: PriceObservation | null = null,
) {
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
    // `unknown` explicitly means there is no trustworthy ownership event
    // time. Do not leak a stale or import-time value under that precision.
    purchasedAt:
      row.purchased_at_precision === "unknown" ? null : row.purchased_at,
    purchasedAtPrecision: row.purchased_at_precision,
    // Issue #45: never invent paid purchase or store current price.
    purchasePrice: null,
    currentPrice: null,
    priceObservation,
  });
}

function matchesTextQuery(
  row: ListingRow,
  q: string | undefined,
  maker: string | undefined,
): boolean {
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

/**
 * Read a stored observation tier amount for a currency.
 * Returns null when the tier is missing or currency mismatches.
 * Never falls back to purchasePrice/currentPrice.
 */
function observationTierAmount(
  observation: PriceObservation | null | undefined,
  tier: PriceTier,
  currency: string,
): number | null {
  if (!observation) return null;
  const money = observation[tier];
  if (!money || money.currency !== currency) return null;
  return money.amountMinor;
}

/** True when the observation has the given currency on the selected or any tier. */
function observationMatchesCurrency(
  observation: PriceObservation | null | undefined,
  currency: string,
  tier: PriceTier | undefined,
): boolean {
  if (!observation) return false;
  if (tier) {
    return observationTierAmount(observation, tier, currency) !== null;
  }
  for (const key of ["regular", "sale", "coupon"] as const) {
    if (observationTierAmount(observation, key, currency) !== null) return true;
  }
  return false;
}

function compareNullableNumber(
  a: number | null,
  b: number | null,
  direction: "asc" | "desc",
): number {
  // Missing observation amounts always sort last (never treated as 0).
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === "asc" ? a - b : b - a;
}

function compareNullableString(
  a: string | null,
  b: string | null,
  direction: "asc" | "desc",
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const cmp = a < b ? -1 : a > b ? 1 : 0;
  return direction === "asc" ? cmp : -cmp;
}

function tieBreak(a: ListingRow, b: ListingRow): number {
  if (a.work_id !== b.work_id) return a.work_id - b.work_id;
  return a.id - b.id;
}

function sortListings(
  rows: ListingRow[],
  observations: Map<number, PriceObservation>,
  query: ListingsQuery,
): ListingRow[] {
  const sort = query.sort ?? "work";
  const ordered = rows.slice();

  ordered.sort((a, b) => {
    let primary = 0;
    switch (sort) {
      case "title_asc":
        primary = compareNullableString(a.title, b.title, "asc");
        break;
      case "title_desc":
        primary = compareNullableString(a.title, b.title, "desc");
        break;
      case "purchased_at_asc":
        primary = compareNullableString(
          a.purchased_at_precision === "unknown" ? null : a.purchased_at,
          b.purchased_at_precision === "unknown" ? null : b.purchased_at,
          "asc",
        );
        break;
      case "purchased_at_desc":
        primary = compareNullableString(
          a.purchased_at_precision === "unknown" ? null : a.purchased_at,
          b.purchased_at_precision === "unknown" ? null : b.purchased_at,
          "desc",
        );
        break;
      case "price_observation_asc":
      case "price_observation_desc": {
        // Schema requires priceCurrency + priceTier for these sorts.
        const currency = query.priceCurrency!;
        const tier = query.priceTier!;
        const direction = sort === "price_observation_asc" ? "asc" : "desc";
        primary = compareNullableNumber(
          observationTierAmount(observations.get(a.id), tier, currency),
          observationTierAmount(observations.get(b.id), tier, currency),
          direction,
        );
        break;
      }
      case "work":
      default:
        primary = 0;
        break;
    }
    return primary !== 0 ? primary : tieBreak(a, b);
  });

  return ordered;
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
    priceCurrency: url.searchParams.get("priceCurrency") ?? undefined,
    priceTier: url.searchParams.get("priceTier") ?? undefined,
    sort: url.searchParams.get("sort") ?? undefined,
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

  // Load all observations before price filter/sort so pagination sees the
  // full ordered set. Never consult purchasePrice/currentPrice columns.
  const observations = loadPriceObservationsByListingIds(
    ctx.db,
    rows.map((row) => row.id),
  );

  let filtered = rows.filter((row) => {
    if (query.source && row.source !== query.source) return false;
    if (!matchesTextQuery(row, query.q, query.maker)) return false;
    if (query.priceCurrency) {
      if (
        !observationMatchesCurrency(
          observations.get(row.id),
          query.priceCurrency,
          query.priceTier,
        )
      ) {
        return false;
      }
    }
    return true;
  });

  filtered = sortListings(filtered, observations, query);

  const total = filtered.length;
  const offset = query.offset ?? 0;
  const limit = query.limit ?? 500;
  const page = filtered.slice(offset, offset + limit);

  json(
    res,
    200,
    ListingsResponseSchema.parse({
      listings: page.map((row) =>
        rowToListing(row, observations.get(row.id) ?? null),
      ),
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
