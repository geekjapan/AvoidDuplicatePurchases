import {
  MarketOfferPriceSchema,
  MoneySchema,
  RelatedProductsResponseSchema,
  RelationEvidenceSchema,
  makerMatchKey,
  normalizeCid,
  titleMatchKey,
  type MarketOfferPrice,
  type Money,
  type RelatedImportRequest,
  type RelatedImportResponse,
  type RelatedProductsItem,
  type RelatedProductsQuery,
  type RelatedProductsResponse,
  type RelationEvidence,
  type Source,
} from "@adp/shared";
import type { DatabaseSync } from "node:sqlite";

/** Initial fixed freshness window from issue #47 sales contract. */
export const RELATED_PRICE_FRESHNESS_TTL_MS = 24 * 60 * 60 * 1000;

const RELATION_PRIORITY: Record<RelationEvidence["kind"], number> = {
  store_related: 3,
  series: 2,
  maker: 1,
  author: 1,
};

const FRESHNESS_RANK: Record<MarketOfferPrice["freshness"], number> = {
  fresh: 0,
  stale: 1,
  unavailable: 2,
};

type ListingIdentityRow = {
  source: Source;
  cid: string;
  work_id: number;
  title: string;
  maker_name: string | null;
};

type EdgeRow = {
  product_source: Source;
  product_cid: string;
  relation_kind: RelationEvidence["kind"];
  evidence_json: string;
  observed_at: string;
};

type OfferRow = {
  source: Source;
  cid: string;
  title: string;
  maker_name: string | null;
  series_id: string | null;
  image_url: string | null;
  product_url: string | null;
  availability: "available" | "unavailable" | "unknown";
  current_amount_minor: number | null;
  current_currency: string | null;
  current_tax_status: Money["taxStatus"] | null;
  regular_amount_minor: number | null;
  regular_currency: string | null;
  regular_tax_status: Money["taxStatus"] | null;
  discount_percent: number | null;
  sale_ends_at: string | null;
  price_observed_at: string | null;
  raw_json: string;
  imported_at: string;
};

function moneyFromColumns(
  amount: number | null,
  currency: string | null,
  taxStatus: Money["taxStatus"] | null,
): Money | null {
  if (amount === null || currency === null || taxStatus === null) return null;
  return MoneySchema.parse({ amountMinor: amount, currency, taxStatus });
}

function moneyColumns(
  money: Money | null,
): [number | null, string | null, Money["taxStatus"] | null] {
  if (!money) return [null, null, null];
  return [money.amountMinor, money.currency, money.taxStatus];
}

function roundDiscountPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Prefer explicit discount; otherwise derive only when current/regular share
 * currency + taxStatus and regular amount is positive.
 */
export function resolveDiscountPercent(
  current: Money | null,
  regular: Money | null,
  explicit: number | null | undefined,
): number | null {
  if (explicit !== undefined && explicit !== null) {
    return roundDiscountPercent(explicit);
  }
  if (
    current &&
    regular &&
    current.currency === regular.currency &&
    current.taxStatus === regular.taxStatus &&
    regular.amountMinor > 0 &&
    current.amountMinor <= regular.amountMinor
  ) {
    const raw = ((regular.amountMinor - current.amountMinor) / regular.amountMinor) * 100;
    return roundDiscountPercent(raw);
  }
  return null;
}

export function computeFreshness(
  observedAt: string | null,
  current: Money | null,
  regular: Money | null,
  nowMs: number = Date.now(),
): MarketOfferPrice["freshness"] {
  if (current === null && regular === null) return "unavailable";
  if (!observedAt) return "unavailable";
  const observedMs = Date.parse(observedAt);
  if (!Number.isFinite(observedMs)) return "unavailable";
  if (nowMs - observedMs > RELATED_PRICE_FRESHNESS_TTL_MS) return "stale";
  return "fresh";
}

export function buildMarketOfferPrice(
  input: {
    current: Money | null;
    regular: Money | null;
    discountPercent?: number | null;
    saleEndsAt?: string | null;
    observedAt: string | null;
  },
  nowMs: number = Date.now(),
): MarketOfferPrice {
  const current = input.current;
  const regular = input.regular;
  const discountPercent = resolveDiscountPercent(
    current,
    regular,
    input.discountPercent ?? null,
  );
  const freshness = computeFreshness(input.observedAt, current, regular, nowMs);
  return MarketOfferPriceSchema.parse({
    current: freshness === "unavailable" ? null : current,
    regular: freshness === "unavailable" ? null : regular,
    discountPercent: freshness === "unavailable" ? null : discountPercent,
    saleEndsAt: input.saleEndsAt ?? null,
    observedAt: input.observedAt,
    freshness,
  });
}

function maxRelationPriority(evidence: RelationEvidence[]): number {
  let max = 0;
  for (const item of evidence) {
    max = Math.max(max, RELATION_PRIORITY[item.kind] ?? 0);
  }
  return max;
}

function productKey(source: string, cid: string): string {
  return `${source}\0${cid}`;
}

function loadAnchorListing(
  db: DatabaseSync,
  source: Source,
  cid: string,
): ListingIdentityRow | null {
  const normalized = normalizeCid(source, cid);
  const row = db
    .prepare(
      `SELECT source, cid, work_id, title, maker_name
       FROM listing WHERE source = ? AND cid = ?`,
    )
    .get(source, normalized) as ListingIdentityRow | undefined;
  return row ?? null;
}

function loadOwnedByWork(db: DatabaseSync, workId: number): Array<{ source: Source; cid: string }> {
  return db
    .prepare(`SELECT source, cid FROM listing WHERE work_id = ? ORDER BY source, cid`)
    .all(workId) as Array<{ source: Source; cid: string }>;
}

function findExactTitleMakerMatches(
  db: DatabaseSync,
  title: string,
  maker: string | null,
  excludeSource: Source,
  excludeCid: string,
): Array<{ source: Source; cid: string }> {
  if (!maker) return [];
  const makerKey = makerMatchKey(maker);
  const titleKey = titleMatchKey(title);
  if (!makerKey || !titleKey) return [];

  const rows = db
    .prepare(
      `SELECT l.source, l.cid, l.title
       FROM match_key mk
       JOIN listing l ON l.id = mk.listing_id
       WHERE mk.kind = 'maker' AND mk.key = ?`,
    )
    .all(makerKey) as Array<{ source: Source; cid: string; title: string }>;

  const hits: Array<{ source: Source; cid: string }> = [];
  for (const row of rows) {
    if (row.source === excludeSource && row.cid === excludeCid) continue;
    if (titleMatchKey(row.title) !== titleKey) continue;
    hits.push({ source: row.source, cid: row.cid });
  }
  return hits;
}

function resolveOwnership(
  db: DatabaseSync,
  product: { source: Source; cid: string; title: string; maker: string | null },
): RelatedProductsItem["ownership"] {
  const ownedRow = db
    .prepare(`SELECT work_id FROM listing WHERE source = ? AND cid = ?`)
    .get(product.source, product.cid) as { work_id: number } | undefined;

  if (ownedRow) {
    return {
      status: "owned",
      matchedBy: "source_cid",
      ownedBy: loadOwnedByWork(db, ownedRow.work_id),
    };
  }

  const cross = findExactTitleMakerMatches(
    db,
    product.title,
    product.maker,
    product.source,
    product.cid,
  );
  if (cross.length > 0) {
    return {
      status: "possible_duplicate",
      matchedBy: "title_maker",
      ownedBy: cross,
    };
  }

  return {
    status: "not_confirmed",
    matchedBy: null,
    ownedBy: [],
  };
}

function parseEvidenceJson(raw: string): RelationEvidence | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = RelationEvidenceSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function loadOffer(
  db: DatabaseSync,
  source: Source,
  cid: string,
): OfferRow | null {
  const row = db
    .prepare(
      `SELECT source, cid, title, maker_name, series_id, image_url, product_url,
              availability,
              current_amount_minor, current_currency, current_tax_status,
              regular_amount_minor, regular_currency, regular_tax_status,
              discount_percent, sale_ends_at, price_observed_at,
              raw_json, imported_at
       FROM market_offer WHERE source = ? AND cid = ?`,
    )
    .get(source, cid) as OfferRow | undefined;
  return row ?? null;
}

function compareItems(
  a: RelatedProductsItem,
  b: RelatedProductsItem,
  sort: NonNullable<RelatedProductsQuery["sort"]>,
  nowMs: number,
): number {
  const byStable = (): number => {
    if (a.product.source !== b.product.source) {
      return a.product.source < b.product.source ? -1 : 1;
    }
    if (a.product.cid !== b.product.cid) {
      return a.product.cid < b.product.cid ? -1 : 1;
    }
    return 0;
  };

  const byRelation = (): number =>
    maxRelationPriority(b.relation.evidence) - maxRelationPriority(a.relation.evidence);

  const byFreshness = (): number =>
    FRESHNESS_RANK[a.price.freshness] - FRESHNESS_RANK[b.price.freshness];

  const byPriceAsc = (): number => {
    const ac = a.price.current;
    const bc = b.price.current;
    if (!ac && !bc) return 0;
    if (!ac) return 1;
    if (!bc) return -1;
    if (ac.currency !== bc.currency) {
      return ac.currency < bc.currency ? -1 : 1;
    }
    if (ac.amountMinor !== bc.amountMinor) return ac.amountMinor - bc.amountMinor;
    return 0;
  };

  const byDiscountDesc = (): number => {
    const ad = a.price.discountPercent;
    const bd = b.price.discountPercent;
    if (ad === null && bd === null) return 0;
    if (ad === null) return 1;
    if (bd === null) return -1;
    if (ad !== bd) return bd - ad;
    return 0;
  };

  const bySaleEndsAsc = (): number => {
    const aEnd = a.price.saleEndsAt ? Date.parse(a.price.saleEndsAt) : NaN;
    const bEnd = b.price.saleEndsAt ? Date.parse(b.price.saleEndsAt) : NaN;
    const aActive = Number.isFinite(aEnd) && aEnd >= nowMs;
    const bActive = Number.isFinite(bEnd) && bEnd >= nowMs;
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    if (aActive && bActive && aEnd !== bEnd) return aEnd - bEnd;
    return 0;
  };

  const byTitle = (): number => {
    if (a.product.title === b.product.title) return 0;
    return a.product.title < b.product.title ? -1 : 1;
  };

  if (sort === "title_asc") {
    return byTitle() || byRelation() || byStable();
  }
  if (sort === "price_asc") {
    return byPriceAsc() || byRelation() || byFreshness() || byStable();
  }
  if (sort === "discount_desc") {
    return byDiscountDesc() || byRelation() || byFreshness() || byStable();
  }
  if (sort === "sale_ends_asc") {
    return bySaleEndsAsc() || byRelation() || byFreshness() || byStable();
  }
  // relevance
  return byRelation() || byFreshness() || byPriceAsc() || byStable();
}

/**
 * Import synthetic_related_v1 items into related_edge + market_offer.
 * Never writes to `listing`. Anchor must already be an owned listing.
 */
export function importRelatedProducts(
  db: DatabaseSync,
  request: RelatedImportRequest,
  observedAt: string = new Date().toISOString(),
):
  | { ok: true; result: RelatedImportResponse }
  | { ok: false; error: "not_found" | "invalid_request" } {
  const anchor = loadAnchorListing(db, request.anchor.source, request.anchor.cid);
  if (!anchor) return { ok: false, error: "not_found" };

  const anchorSource = anchor.source;
  const anchorCid = anchor.cid;

  // Canonicalize product cids at the import boundary so self/owned guards and
  // related_edge/market_offer writes share listing identity conventions (DLsite upper).
  const items = request.items.map((item) => ({
    ...item,
    product: {
      ...item.product,
      cid: normalizeCid(item.product.source, item.product.cid),
    },
  }));

  // Reject items that would re-register the anchor itself as a related offer.
  for (const item of items) {
    if (item.product.source === anchorSource && item.product.cid === anchorCid) {
      return { ok: false, error: "invalid_request" };
    }
    // Fail closed: never treat an already-owned (source,cid) as a market_offer.
    // Caller should use owned=mark on GET for owned candidates, not import them.
    const owned = db
      .prepare(`SELECT 1 FROM listing WHERE source = ? AND cid = ?`)
      .get(item.product.source, item.product.cid);
    if (owned) return { ok: false, error: "invalid_request" };
  }

  let edgesUpserted = 0;
  let edgesRemoved = 0;
  let offersUpserted = 0;

  const run = db.prepare("BEGIN IMMEDIATE");
  const commit = db.prepare("COMMIT");
  const rollback = db.prepare("ROLLBACK");

  try {
    run.run();

    if (request.complete) {
      const existing = db
        .prepare(
          `SELECT product_source, product_cid, relation_kind
           FROM related_edge
           WHERE anchor_source = ? AND anchor_cid = ?`,
        )
        .all(anchorSource, anchorCid) as Array<{
        product_source: Source;
        product_cid: string;
        relation_kind: string;
      }>;

      const keep = new Set<string>();
      for (const item of items) {
        for (const evidence of item.evidence) {
          keep.add(
            productKey(item.product.source, item.product.cid) + "\0" + evidence.kind,
          );
        }
      }

      const del = db.prepare(
        `DELETE FROM related_edge
         WHERE anchor_source = ? AND anchor_cid = ?
           AND product_source = ? AND product_cid = ?
           AND relation_kind = ?`,
      );
      for (const edge of existing) {
        const key =
          productKey(edge.product_source, edge.product_cid) + "\0" + edge.relation_kind;
        if (!keep.has(key)) {
          del.run(
            anchorSource,
            anchorCid,
            edge.product_source,
            edge.product_cid,
            edge.relation_kind,
          );
          edgesRemoved += 1;
        }
      }
    }

    const upsertEdge = db.prepare(
      `INSERT INTO related_edge (
         anchor_source, anchor_cid, product_source, product_cid,
         relation_kind, evidence_json, observed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(anchor_source, anchor_cid, product_source, product_cid, relation_kind)
       DO UPDATE SET
         evidence_json = excluded.evidence_json,
         observed_at = excluded.observed_at`,
    );

    const upsertOffer = db.prepare(
      `INSERT INTO market_offer (
         source, cid, title, maker_name, series_id, image_url, product_url,
         availability,
         current_amount_minor, current_currency, current_tax_status,
         regular_amount_minor, regular_currency, regular_tax_status,
         discount_percent, sale_ends_at, price_observed_at,
         raw_json, imported_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?,
         ?,
         ?, ?, ?,
         ?, ?, ?,
         ?, ?, ?,
         ?, ?
       )
       ON CONFLICT(source, cid) DO UPDATE SET
         title = excluded.title,
         maker_name = excluded.maker_name,
         series_id = excluded.series_id,
         image_url = excluded.image_url,
         product_url = excluded.product_url,
         availability = excluded.availability,
         current_amount_minor = excluded.current_amount_minor,
         current_currency = excluded.current_currency,
         current_tax_status = excluded.current_tax_status,
         regular_amount_minor = excluded.regular_amount_minor,
         regular_currency = excluded.regular_currency,
         regular_tax_status = excluded.regular_tax_status,
         discount_percent = excluded.discount_percent,
         sale_ends_at = excluded.sale_ends_at,
         price_observed_at = excluded.price_observed_at,
         raw_json = excluded.raw_json,
         imported_at = excluded.imported_at`,
    );

    for (const item of items) {
      for (const evidence of item.evidence) {
        upsertEdge.run(
          anchorSource,
          anchorCid,
          item.product.source,
          item.product.cid,
          evidence.kind,
          JSON.stringify(evidence),
          observedAt,
        );
        edgesUpserted += 1;
      }

      const current = item.price.current;
      const regular = item.price.regular;
      const discount = resolveDiscountPercent(
        current,
        regular,
        item.price.discountPercent ?? null,
      );
      const [cAmt, cCur, cTax] = moneyColumns(current);
      const [rAmt, rCur, rTax] = moneyColumns(regular);

      // Explicit "no price" success still stamps observedAt so unavailable is fresh knowledge.
      const priceObservedAt =
        current === null && regular === null ? observedAt : observedAt;

      upsertOffer.run(
        item.product.source,
        item.product.cid,
        item.product.title,
        item.product.maker,
        item.product.seriesId,
        item.product.imageUrl,
        item.product.productUrl,
        item.availability,
        cAmt,
        cCur,
        cTax,
        rAmt,
        rCur,
        rTax,
        discount,
        item.price.saleEndsAt ?? null,
        priceObservedAt,
        JSON.stringify({
          contract: request.contract,
          product: item.product,
          evidence: item.evidence,
          price: item.price,
          availability: item.availability,
        }),
        observedAt,
      );
      offersUpserted += 1;
    }

    commit.run();
  } catch {
    try {
      rollback.run();
    } catch {
      // ignore rollback errors
    }
    return { ok: false, error: "invalid_request" };
  }

  return {
    ok: true,
    result: {
      edgesUpserted,
      edgesRemoved,
      offersUpserted,
    },
  };
}

/**
 * Build related-products response for an owned anchor listing.
 */
export function getRelatedProducts(
  db: DatabaseSync,
  query: RelatedProductsQuery,
  nowMs: number = Date.now(),
):
  | { ok: true; response: RelatedProductsResponse }
  | { ok: false; error: "not_found" } {
  const anchor = loadAnchorListing(db, query.anchorSource, query.anchorCid);
  if (!anchor) return { ok: false, error: "not_found" };

  const ownedMode = query.owned ?? "exclude";
  const sort = query.sort ?? "relevance";
  const limit = query.limit ?? 100;
  const offset = query.offset ?? 0;

  const edgeRows = db
    .prepare(
      `SELECT product_source, product_cid, relation_kind, evidence_json, observed_at
       FROM related_edge
       WHERE anchor_source = ? AND anchor_cid = ?
       ORDER BY product_source, product_cid, relation_kind`,
    )
    .all(anchor.source, anchor.cid) as EdgeRow[];

  const byProduct = new Map<string, RelationEvidence[]>();
  for (const row of edgeRows) {
    if (query.source && row.product_source !== query.source) continue;
    const key = productKey(row.product_source, row.product_cid);
    const evidence = parseEvidenceJson(row.evidence_json);
    if (!evidence) continue;
    // Drop anything outside the allowed relation kinds (defense in depth).
    if (
      evidence.kind !== "maker" &&
      evidence.kind !== "author" &&
      evidence.kind !== "series" &&
      evidence.kind !== "store_related"
    ) {
      continue;
    }
    const list = byProduct.get(key) ?? [];
    list.push(evidence);
    byProduct.set(key, list);
  }

  const items: RelatedProductsItem[] = [];
  const warnings: RelatedProductsResponse["warnings"] = [];

  for (const [key, evidence] of byProduct) {
    if (evidence.length === 0) continue;
    const [source, cid] = key.split("\0") as [Source, string];
    const offer = loadOffer(db, source, cid);
    if (!offer) {
      // Edge without offer metadata: still return product with unavailable price
      // using identity from the edge only — but we need title. Skip incomplete.
      warnings.push({ source, code: "unavailable" });
      continue;
    }

    const product = {
      source: offer.source,
      cid: offer.cid,
      title: offer.title,
      maker: offer.maker_name,
      seriesId: offer.series_id,
      imageUrl: offer.image_url,
      productUrl: offer.product_url,
    };

    const ownership = resolveOwnership(db, product);
    if (
      ownedMode === "exclude" &&
      (ownership.status === "owned" || ownership.status === "possible_duplicate")
    ) {
      continue;
    }

    const current = moneyFromColumns(
      offer.current_amount_minor,
      offer.current_currency,
      offer.current_tax_status,
    );
    const regular = moneyFromColumns(
      offer.regular_amount_minor,
      offer.regular_currency,
      offer.regular_tax_status,
    );

    if (query.currency) {
      const matchesCurrency =
        (current && current.currency === query.currency) ||
        (regular && regular.currency === query.currency);
      // Currency filter applies only when a priced amount exists in that currency.
      // Unavailable prices are kept only when no currency filter is set.
      if ((current || regular) && !matchesCurrency) continue;
      if (!current && !regular) continue;
    }

    const price = buildMarketOfferPrice(
      {
        current,
        regular,
        discountPercent: offer.discount_percent,
        saleEndsAt: offer.sale_ends_at,
        observedAt: offer.price_observed_at,
      },
      nowMs,
    );

    if (price.freshness === "stale") {
      warnings.push({ source: product.source, code: "stale" });
    } else if (price.freshness === "unavailable") {
      warnings.push({ source: product.source, code: "unavailable" });
    }

    items.push({
      product,
      relation: { evidence },
      ownership,
      price,
    });
  }

  items.sort((a, b) => compareItems(a, b, sort, nowMs));

  const total = items.length;
  const page = items.slice(offset, offset + limit);

  const response = RelatedProductsResponseSchema.parse({
    anchor: { source: anchor.source, cid: anchor.cid },
    generatedAt: new Date(nowMs).toISOString(),
    items: page,
    total,
    warnings,
  });

  return { ok: true, response };
}
