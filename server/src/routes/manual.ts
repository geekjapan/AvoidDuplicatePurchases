import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError } from "zod";
import {
  ManualListingRequestSchema,
  ManualListingResponseSchema,
  ListingSchema,
  normalizeCid,
  type Source,
} from "@adp/shared";
import {
  parseDlsiteProductJson,
  isValidDlsiteWorkno,
} from "@adp/shared/adapters/dlsite";
import { registerApiRouteMount } from "../route-mounts.js";
import type { ApiContext } from "../http.js";
import { upsertFanzaListing } from "../import/fanza/common.js";
import { recomputeMatchKeys } from "../services/lookup.js";
import type { ProductFetcher } from "../services/import.js";

export interface ParsedProductUrl {
  source: Source;
  cid: string;
  seriesId?: string;
  videoFloor?: string;
}

/** Canonical product URL → (source, cid) contract for supported stores. */
export function parseManualProductUrl(input: string): ParsedProductUrl | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const href = url.href;

  const dlsite = /product_id\/([BRV][JE]\d{6,8})/i.exec(href);
  if (dlsite && isValidDlsiteWorkno(dlsite[1]!)) {
    return { source: "dlsite", cid: dlsite[1]!.toUpperCase() };
  }

  const books = /book\.dmm\.co\.jp\/product\/(\d+)\/([a-z0-9]+)/i.exec(href);
  if (books) {
    return {
      source: "fanza_books",
      cid: books[2]!,
      seriesId: books[1]!,
    };
  }

  if (/video\.dmm\.co\.jp/i.test(href)) {
    const id = url.searchParams.get("id")?.trim();
    if (id) {
      const floor = /video\.dmm\.co\.jp\/(av|amateur)\//i.exec(href)?.[1]?.toLowerCase();
      return { source: "fanza_video", cid: id, videoFloor: floor };
    }
  }

  const dlsoft = /dlsoft\.dmm\.co\.jp\/detail\/([^/?#]+)/i.exec(href);
  if (dlsoft) {
    return { source: "fanza_dlsoft", cid: decodeURIComponent(dlsoft[1]!) };
  }

  const doujin =
    /\/detail\/=\/cid=([^/]+)/i.exec(href) ??
    (/doujin/i.test(href) ? /[?&]cid=([^&/]+)/i.exec(href) : null);
  if (doujin) {
    return { source: "fanza_doujin", cid: decodeURIComponent(doujin[1]!) };
  }

  return null;
}

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

function validationError(res: ServerResponse): void {
  json(res, 400, { error: "invalid_request" });
}

async function enrichDlsiteListing(
  cid: string,
  productFetcher: ProductFetcher | undefined,
): Promise<{
  title: string;
  maker: string | null;
  imageUrl: string | null;
  rawJson: string;
}> {
  const fallbackTitle = cid;
  const fallback = {
    title: fallbackTitle,
    maker: null as string | null,
    imageUrl: null as string | null,
    rawJson: JSON.stringify({ manual: true, urlKind: "dlsite", cid }),
  };
  if (!productFetcher) return fallback;
  try {
    const raw = await productFetcher(cid);
    if (!raw) return fallback;
    const product = parseDlsiteProductJson(raw);
    if (!product || product.workno !== cid) return fallback;
    return {
      title: product.work_name,
      maker: product.maker_name ?? null,
      imageUrl: product.image_url ?? null,
      rawJson: JSON.stringify({ manual: true, product: product.raw }),
    };
  } catch {
    return fallback;
  }
}

function listingRow(
  db: ApiContext["db"],
  source: Source,
  cid: string,
): {
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
} | undefined {
  return db
    .prepare(
      `SELECT id, source, cid, work_id, work_id_locked, title, maker_name, series_id, image_url, purchased_at
       FROM listing WHERE source = ? AND cid = ?`,
    )
    .get(source, cid) as
    | {
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
      }
    | undefined;
}

async function handleManualRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
  url: URL,
): Promise<boolean> {
  if (req.method !== "POST" || url.pathname !== "/api/listings/manual") return false;

  const raw = await readBody(req);
  let body: unknown;
  try {
    body = raw.length ? JSON.parse(raw) : null;
  } catch {
    validationError(res);
    return true;
  }
  const parsed = parseZod(ManualListingRequestSchema, body);
  if (!parsed) {
    validationError(res);
    return true;
  }

  const identity = parseManualProductUrl(parsed.url);
  if (!identity) {
    validationError(res);
    return true;
  }

  const cid = normalizeCid(identity.source, identity.cid);
  const now = new Date().toISOString();

  let title = cid;
  let maker: string | null = null;
  const seriesId: string | null = identity.seriesId ?? null;
  let imageUrl: string | null = null;
  let rawJson = JSON.stringify({
    manual: true,
    url: parsed.url,
    source: identity.source,
    cid,
    seriesId: identity.seriesId ?? null,
    videoFloor: identity.videoFloor ?? null,
  });

  if (identity.source === "dlsite") {
    const enriched = await enrichDlsiteListing(cid, ctx.productFetcher);
    title = enriched.title;
    maker = enriched.maker;
    imageUrl = enriched.imageUrl;
    rawJson = enriched.rawJson;
  } else {
    title = cid;
  }

  const result = upsertFanzaListing(
    ctx.db,
    identity.source,
    {
      cid,
      title,
      maker,
      seriesId,
      imageUrl,
      purchasedAt: null,
      purchasedAtPrecision: "unknown",
      rawJson,
    },
    now,
  );

  const row = listingRow(ctx.db, identity.source, cid);
  if (!row) {
    json(res, 500, { error: "internal_error" });
    return true;
  }
  recomputeMatchKeys(ctx.db, row.id);

  json(
    res,
    result === "inserted" ? 201 : 200,
    ManualListingResponseSchema.parse({
      listing: ListingSchema.parse({
        id: row.id,
        source: row.source,
        cid: row.cid,
        workId: row.work_id,
        workIdLocked: row.work_id_locked === 1,
        title: row.title,
        maker: row.maker_name,
        seriesId: row.series_id,
        imageUrl: row.image_url,
        purchasedAt: row.purchased_at,
      }),
    }),
  );
  return true;
}

/** Register POST /api/listings/manual (T-ADMIN-OPS). */
export function registerManualRoutes(): void {
  registerApiRouteMount(handleManualRoute);
}

registerManualRoutes();
