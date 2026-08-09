import type { DatabaseSync } from "node:sqlite";
import {
  MoneySchema,
  PriceObservationSchema,
  type Money,
  type PriceObservation,
  type Source,
} from "@adp/shared";
import { productUrlForSource } from "@adp/shared/adapters/dlsite";
import { extractFanzaVideoFloorFromRawJson } from "./lookup.js";

/** Sources that may report visible product-page price tiers (issue #45). */
export const PRICE_OBSERVATION_SOURCES = [
  "dlsite",
  "fanza_doujin",
  "fanza_books",
] as const;

export type PriceObservationSource = (typeof PRICE_OBSERVATION_SOURCES)[number];

export function isPriceObservationSource(
  source: string,
): source is PriceObservationSource {
  return (PRICE_OBSERVATION_SOURCES as readonly string[]).includes(source);
}

interface ListingIdentityRow {
  id: number;
  source: Source;
  cid: string;
  series_id: string | null;
  raw_json: string;
}

interface PriceObservationRow {
  regular_amount_minor: number | null;
  regular_currency: string | null;
  regular_tax_status: Money["taxStatus"] | null;
  sale_amount_minor: number | null;
  sale_currency: string | null;
  sale_tax_status: Money["taxStatus"] | null;
  coupon_amount_minor: number | null;
  coupon_currency: string | null;
  coupon_tax_status: Money["taxStatus"] | null;
  observed_at: string;
}

function tierFromColumns(
  amount: number | null,
  currency: string | null,
  taxStatus: Money["taxStatus"] | null,
): Money | null {
  if (amount === null || currency === null || taxStatus === null) return null;
  return MoneySchema.parse({ amountMinor: amount, currency, taxStatus });
}

function tierColumns(money: Money | null): [number | null, string | null, Money["taxStatus"] | null] {
  if (!money) return [null, null, null];
  return [money.amountMinor, money.currency, money.taxStatus];
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function rowToPriceObservation(row: PriceObservationRow): PriceObservation {
  return PriceObservationSchema.parse({
    regular: tierFromColumns(
      row.regular_amount_minor,
      row.regular_currency,
      row.regular_tax_status,
    ),
    sale: tierFromColumns(row.sale_amount_minor, row.sale_currency, row.sale_tax_status),
    coupon: tierFromColumns(
      row.coupon_amount_minor,
      row.coupon_currency,
      row.coupon_tax_status,
    ),
    observedAt: row.observed_at,
  });
}

export function loadPriceObservation(
  db: DatabaseSync,
  listingId: number,
): PriceObservation | null {
  const row = db
    .prepare(
      `SELECT regular_amount_minor, regular_currency, regular_tax_status,
              sale_amount_minor, sale_currency, sale_tax_status,
              coupon_amount_minor, coupon_currency, coupon_tax_status,
              observed_at
       FROM price_observation WHERE listing_id = ?`,
    )
    .get(listingId) as PriceObservationRow | undefined;
  return row ? rowToPriceObservation(row) : null;
}

export function loadPriceObservationsByListingIds(
  db: DatabaseSync,
  listingIds: readonly number[],
): Map<number, PriceObservation> {
  const map = new Map<number, PriceObservation>();
  const uniqueIds = Array.from(
    new Set(
      listingIds.filter(
        (id): id is number => Number.isSafeInteger(id) && id > 0,
      ),
    ),
  );
  if (uniqueIds.length === 0) return map;

  // Keep each IN list below SQLite's default bind-variable limit while still
  // doing bounded batch reads instead of one query per listing row.
  const maxBindVariables = 900;
  for (let start = 0; start < uniqueIds.length; start += maxBindVariables) {
    const ids = uniqueIds.slice(start, start + maxBindVariables);
    const placeholders = ids.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT listing_id, regular_amount_minor, regular_currency, regular_tax_status,
                sale_amount_minor, sale_currency, sale_tax_status,
                coupon_amount_minor, coupon_currency, coupon_tax_status,
                observed_at
         FROM price_observation WHERE listing_id IN (${placeholders})`,
      )
      .all(...ids) as Array<PriceObservationRow & { listing_id: number }>;
    for (const row of rows) {
      map.set(row.listing_id, rowToPriceObservation(row));
    }
  }
  return map;
}

/**
 * Accept only absolute https product URLs that match the owned listing identity.
 * Rejects credentials, non-https, query/hash, host/path mismatches, and CID mismatches.
 * Price-observation sources (DLsite / FANZA doujin / FANZA books) use
 * origin+pathname canonical product URLs only — fail closed on query/hash.
 * Returns the safe origin+pathname form, or null when the URL is not canonical.
 */
export function canonicalizeOwnedProductUrl(
  pageUrl: string,
  listing: ListingIdentityRow,
): string | null {
  // Price observation must not rely on the general display sanitizer alone:
  // that helper allows query (e.g. FANZA video) and returns the raw input.
  let url: URL;
  try {
    url = new URL(pageUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) {
    return null;
  }
  // Fail closed: no query, hash, or non-default port on observed product pages.
  if (url.search !== "" || url.hash !== "" || url.port !== "") {
    return null;
  }

  const cid = listing.cid.trim();
  const canonical = `${url.origin}${url.pathname}`;
  switch (listing.source) {
    case "dlsite": {
      // CID-derived canonical floor/path only (RJ→maniax, BJ→books, VJ→pro).
      // Wrong-floor URLs (e.g. RJ on /pro/) fail closed as invalid_page.
      const expected = productUrlForSource("dlsite", cid);
      if (!expected) return null;
      try {
        const want = new URL(expected);
        if (
          url.hostname !== want.hostname ||
          url.pathname.toLowerCase() !== want.pathname.toLowerCase()
        ) {
          return null;
        }
        return `${want.origin}${want.pathname}`;
      } catch {
        return null;
      }
    }
    case "fanza_doujin": {
      if (url.hostname !== "www.dmm.co.jp") return null;
      const m = /^\/dc\/doujin\/-\/detail\/=\/cid=([^/]+)\/?$/i.exec(url.pathname);
      const pathCid = m ? safeDecodeURIComponent(m[1]!) : null;
      return pathCid === cid ? canonical : null;
    }
    case "fanza_books": {
      if (url.hostname !== "book.dmm.co.jp") return null;
      const m = /^\/product\/([^/]+)\/([^/]+)\/?$/.exec(url.pathname);
      if (!m) return null;
      const pathSeriesId = safeDecodeURIComponent(m[1]!);
      const pathCid = safeDecodeURIComponent(m[2]!);
      if (pathSeriesId === null || pathCid === null || pathCid !== cid) return null;
      // When series_id is known, require path match; otherwise CID match is enough.
      if (listing.series_id && listing.series_id.trim()) {
        return pathSeriesId === listing.series_id.trim() ? canonical : null;
      }
      return canonical;
    }
    default:
      return null;
  }
}

export function pageUrlMatchesListing(
  pageUrl: string,
  listing: ListingIdentityRow,
): boolean {
  return canonicalizeOwnedProductUrl(pageUrl, listing) !== null;
}

export type UpsertPriceObservationInput = {
  source: Source;
  cid: string;
  pageUrl: string;
  regular: Money | null;
  sale: Money | null;
  coupon: Money | null;
};

export type UpsertPriceObservationResult =
  | { ok: true; priceObservation: PriceObservation }
  | { ok: false; error: "not_found" | "invalid_page" | "unsupported_source" };

/**
 * Store a three-tier observation against an existing owned listing only.
 * Never creates a listing. `observedAt` is always server receipt time.
 */
export function upsertPriceObservation(
  db: DatabaseSync,
  input: UpsertPriceObservationInput,
  observedAt: string = new Date().toISOString(),
): UpsertPriceObservationResult {
  if (!isPriceObservationSource(input.source)) {
    return { ok: false, error: "unsupported_source" };
  }

  const listing = db
    .prepare(
      `SELECT id, source, cid, series_id, raw_json
       FROM listing WHERE source = ? AND cid = ?`,
    )
    .get(input.source, input.cid.trim()) as ListingIdentityRow | undefined;

  if (!listing) return { ok: false, error: "not_found" };
  const safePageUrl = canonicalizeOwnedProductUrl(input.pageUrl, listing);
  if (!safePageUrl) {
    return { ok: false, error: "invalid_page" };
  }

  // Cross-check against verified product URL when the adapter can build one.
  // DLsite already requires the full CID-derived path in canonicalizeOwnedProductUrl.
  const expected = productUrlForSource(listing.source, listing.cid, {
    seriesId: listing.series_id,
    videoFloor:
      listing.source === "fanza_video"
        ? extractFanzaVideoFloorFromRawJson(listing.raw_json)
        : null,
  });
  if (expected && listing.source !== "dlsite") {
    try {
      const page = new URL(safePageUrl);
      const want = new URL(expected);
      if (page.hostname !== want.hostname) {
        return { ok: false, error: "invalid_page" };
      }
    } catch {
      return { ok: false, error: "invalid_page" };
    }
  }

  const [rAmt, rCur, rTax] = tierColumns(input.regular);
  const [sAmt, sCur, sTax] = tierColumns(input.sale);
  const [cAmt, cCur, cTax] = tierColumns(input.coupon);

  db.prepare(
    `INSERT INTO price_observation (
       listing_id,
       regular_amount_minor, regular_currency, regular_tax_status,
       sale_amount_minor, sale_currency, sale_tax_status,
       coupon_amount_minor, coupon_currency, coupon_tax_status,
       observed_at, page_url
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(listing_id) DO UPDATE SET
       regular_amount_minor = excluded.regular_amount_minor,
       regular_currency = excluded.regular_currency,
       regular_tax_status = excluded.regular_tax_status,
       sale_amount_minor = excluded.sale_amount_minor,
       sale_currency = excluded.sale_currency,
       sale_tax_status = excluded.sale_tax_status,
       coupon_amount_minor = excluded.coupon_amount_minor,
       coupon_currency = excluded.coupon_currency,
       coupon_tax_status = excluded.coupon_tax_status,
       observed_at = excluded.observed_at,
       page_url = excluded.page_url`,
  ).run(
    listing.id,
    rAmt,
    rCur,
    rTax,
    sAmt,
    sCur,
    sTax,
    cAmt,
    cCur,
    cTax,
    observedAt,
    safePageUrl,
  );

  return {
    ok: true,
    priceObservation: PriceObservationSchema.parse({
      regular: input.regular,
      sale: input.sale,
      coupon: input.coupon,
      observedAt,
    }),
  };
}
