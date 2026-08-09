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
import {
  listingDisplayMetadata,
  sanitizeProductImageUrl,
} from "../services/listing-display.js";
import type { ProductFetcher } from "../services/import.js";

export { sanitizeProductImageUrl } from "../services/listing-display.js";

export interface ParsedProductUrl {
  source: Source;
  cid: string;
  seriesId?: string;
  videoFloor?: string;
}

/**
 * Evidence-backed store cid tokens (ASCII identity only).
 * DLsite uses a stricter workno shape; FANZA public content ids observed in
 * adapters/fixtures are alphanumeric with limited separators (e.g. d_123456, b100xx001).
 */
const FANZA_CID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const FANZA_BOOKS_SERIES_RE = /^\d{1,16}$/;

/** Incomplete / non-hex percent sequences are not accepted product evidence. */
function hasInvalidPercentEncoding(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== "%") continue;
    if (i + 2 >= value.length) return true;
    if (!/^[0-9A-Fa-f]{2}$/.test(value.slice(i + 1, i + 3))) return true;
    i += 2;
  }
  return false;
}

/**
 * Decode a single path/query identity segment.
 * Rejects malformed percent encodings and encoded path/query delimiters.
 */
function decodeIdentitySegment(raw: string): string | null {
  if (!raw || hasInvalidPercentEncoding(raw)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  // Encoded delimiters / whitespace must never become part of a cid.
  if (!decoded || decoded !== decoded.trim()) return null;
  if (/[/?#&=\s%]/.test(decoded)) return null;
  // Non-ASCII / Unicode identity is out of scope for verified product cids.
  if (!/^[\x20-\x7E]+$/.test(decoded)) return null;
  return decoded;
}

function isSafeFanzaCid(cid: string): boolean {
  return FANZA_CID_RE.test(cid);
}

function onlyAllowedQueryKeys(url: URL, allowed: ReadonlySet<string>): boolean {
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) return false;
  }
  return true;
}

/**
 * Parse only absolute https product URLs with no userinfo and default port.
 * Host/path identity is never taken from href substring matches.
 * Fragments are never part of verified product identity.
 */
function parseCanonicalHttpsUrl(input: string): URL | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  // Non-default ports are not part of verified store product URLs.
  if (url.port !== "") return null;
  // Fragments must not appear on canonical product URLs.
  if (url.hash !== "") return null;
  if (hasInvalidPercentEncoding(url.pathname) || hasInvalidPercentEncoding(url.search)) {
    return null;
  }
  return url;
}

/**
 * Canonical product URL → (source, cid) for supported stores.
 * Contracts align with shared adapter product URL builders + content cid host gates:
 * exact hostname, anchored pathname, allowlisted query only, source-specific cid rules.
 */
export function parseManualProductUrl(input: string): ParsedProductUrl | null {
  const url = parseCanonicalHttpsUrl(input);
  if (!url) return null;

  // DLsite: https://www.dlsite.com/<floor>/work/=/product_id/<WORKNO>.html
  if (url.hostname === "www.dlsite.com") {
    if (!onlyAllowedQueryKeys(url, new Set())) return null;
    const match =
      /^\/[A-Za-z0-9-]+\/work\/=\/product_id\/([BRV][JE]\d{6,8})\.html$/i.exec(
        url.pathname,
      );
    if (!match) return null;
    const workno = match[1]!.toUpperCase();
    if (!isValidDlsiteWorkno(workno)) return null;
    return { source: "dlsite", cid: workno };
  }

  // FANZA Books: https://book.dmm.co.jp/product/<series_id>/<content_id>/
  if (url.hostname === "book.dmm.co.jp") {
    if (!onlyAllowedQueryKeys(url, new Set())) return null;
    const match = /^\/product\/(\d+)\/([^/]+)\/?$/i.exec(url.pathname);
    if (!match) return null;
    const seriesId = match[1]!;
    if (!FANZA_BOOKS_SERIES_RE.test(seriesId)) return null;
    const cid = decodeIdentitySegment(match[2]!);
    if (!cid || !isSafeFanzaCid(cid)) return null;
    return { source: "fanza_books", cid, seriesId };
  }

  // FANZA Video: https://video.dmm.co.jp/<av|amateur>/content/?id=<content_id>
  // Exactly one `id` query parameter; no other keys; no fragments.
  if (url.hostname === "video.dmm.co.jp") {
    if (!onlyAllowedQueryKeys(url, new Set(["id"]))) return null;
    const floorMatch = /^\/(av|amateur)\/content\/?$/i.exec(url.pathname);
    if (!floorMatch) return null;
    const ids = url.searchParams.getAll("id");
    if (ids.length !== 1) return null;
    const cid = decodeIdentitySegment(ids[0]!);
    if (!cid || !isSafeFanzaCid(cid)) return null;
    return {
      source: "fanza_video",
      cid,
      videoFloor: floorMatch[1]!.toLowerCase(),
    };
  }

  // FANZA PC games: https://dlsoft.dmm.co.jp/detail/<contentId>/
  if (url.hostname === "dlsoft.dmm.co.jp") {
    if (!onlyAllowedQueryKeys(url, new Set())) return null;
    const match = /^\/detail\/([^/]+)\/?$/i.exec(url.pathname);
    if (!match) return null;
    const cid = decodeIdentitySegment(match[1]!);
    if (!cid || !isSafeFanzaCid(cid)) return null;
    return { source: "fanza_dlsoft", cid };
  }

  // FANZA Doujin: https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=<cid>/
  if (url.hostname === "www.dmm.co.jp") {
    if (!onlyAllowedQueryKeys(url, new Set())) return null;
    const match = /^\/dc\/doujin\/-\/detail\/=\/cid=([^/]+)\/?$/i.exec(url.pathname);
    if (!match) return null;
    const cid = decodeIdentitySegment(match[1]!);
    if (!cid || !isSafeFanzaCid(cid)) return null;
    return { source: "fanza_doujin", cid };
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

function sanitizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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
    // Trust boundary: never write unvalidated optional metadata into listing columns.
    const title = sanitizeOptionalText(product.work_name) ?? fallbackTitle;
    const maker = sanitizeOptionalText(product.maker_name ?? null);
    const imageUrl = sanitizeProductImageUrl(product.image_url ?? null);
    return {
      title,
      maker,
      imageUrl,
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
  purchased_at_precision: "second" | "day" | "unknown";
  raw_json: string;
} | undefined {
  return db
    .prepare(
      `SELECT id, source, cid, work_id, work_id_locked, title, maker_name, series_id, image_url,
              purchased_at, purchased_at_precision, raw_json
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
        purchased_at_precision: "second" | "day" | "unknown";
        raw_json: string;
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

  // Final trust boundary before any DB write (defensive; enrich already sanitizes).
  imageUrl = sanitizeProductImageUrl(imageUrl);
  maker = sanitizeOptionalText(maker);
  title = sanitizeOptionalText(title) ?? cid;

  let status = 200;
  let responseBody: unknown;
  try {
    ctx.db.exec("BEGIN");
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
      throw new Error("listing missing after upsert");
    }
    recomputeMatchKeys(ctx.db, row.id);

    const finalRow = listingRow(ctx.db, identity.source, cid);
    if (!finalRow) {
      throw new Error("listing missing after match_key");
    }

    const display = listingDisplayMetadata({
      source: finalRow.source,
      cid: finalRow.cid,
      seriesId: finalRow.series_id,
      imageUrl: finalRow.image_url,
      rawJson: finalRow.raw_json,
    });

    // Validate response shape before commit so invalid optional metadata cannot
    // leave a partial commit and then 500.
    responseBody = ManualListingResponseSchema.parse({
      listing: ListingSchema.parse({
        id: finalRow.id,
        source: finalRow.source,
        cid: finalRow.cid,
        workId: finalRow.work_id,
        workIdLocked: finalRow.work_id_locked === 1,
        title: finalRow.title,
        maker: finalRow.maker_name,
        seriesId: finalRow.series_id,
        ...display,
        purchasedAt:
          finalRow.purchased_at_precision === "unknown" ? null : finalRow.purchased_at,
        purchasedAtPrecision: finalRow.purchased_at_precision,
        purchasePrice: null,
        currentPrice: null,
        priceObservation: null,
      }),
    });
    ctx.db.exec("COMMIT");
    status = result === "inserted" ? 201 : 200;
  } catch {
    try {
      ctx.db.exec("ROLLBACK");
    } catch {
      // ignore rollback failures when no transaction is open
    }
    json(res, 500, { error: "internal_error" });
    return true;
  }

  json(res, status, responseBody);
  return true;
}

/** Register POST /api/listings/manual (T-ADMIN-OPS). */
export function registerManualRoutes(): void {
  registerApiRouteMount(handleManualRoute);
}

registerManualRoutes();
