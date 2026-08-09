import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import type { DatabaseSync } from "node:sqlite";
import {
  RelatedImportRequestSchema,
  RelatedProductsResponseSchema,
  type RelatedImportRequest,
} from "@adp/shared";
import { openDatabase } from "../src/db.js";
import { handleApi } from "../src/http.js";
import { seedDlsiteFromSales } from "../src/services/import.js";
import {
  RELATED_PRICE_FRESHNESS_TTL_MS,
  buildMarketOfferPrice,
  computeFreshness,
  getRelatedProducts,
  importRelatedProducts,
  resolveDiscountPercent,
} from "../src/services/related-products.js";
import { recomputeMatchKeys } from "../src/services/lookup.js";
import "../src/routes/related-products.js";
import "../src/routes/listings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

function seedAnchor(db: DatabaseSync): void {
  const sales = JSON.parse(readFileSync(join(FIXTURES, "dlsite-sales.json"), "utf8"));
  const product = JSON.parse(
    readFileSync(join(FIXTURES, "dlsite-product-rj000001.json"), "utf8"),
  );
  seedDlsiteFromSales(db, sales.slice(0, 1), { RJ000001: product });
  // Ensure anchor maker is known for derived-evidence fixtures.
  db.prepare(
    `UPDATE listing SET maker_name = ?, title = ? WHERE source = 'dlsite' AND cid = 'RJ000001'`,
  ).run("合成サークル", "合成アンカー作品");
  const row = db
    .prepare(`SELECT id FROM listing WHERE source = 'dlsite' AND cid = 'RJ000001'`)
    .get() as { id: number };
  recomputeMatchKeys(db, row.id);
}

function loadSyntheticImport(): RelatedImportRequest {
  const raw = JSON.parse(
    readFileSync(join(FIXTURES, "related-products-synthetic.json"), "utf8"),
  );
  return RelatedImportRequestSchema.parse(raw);
}

function startServer(db: DatabaseSync): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    let port = 0;
    const server = createServer(async (req, res) => {
      await handleApi(req, res, { db, port });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, port });
    });
    server.on("error", reject);
  });
}

function request(
  port: number,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    import("node:http").then(({ request: httpRequest }) => {
      const body = init.body !== undefined ? JSON.stringify(init.body) : undefined;
      const req = httpRequest(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method: init.method ?? "GET",
          headers: {
            Origin: `http://127.0.0.1:${port}`,
            ...(body
              ? {
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(body),
                }
              : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            resolve({
              status: res.statusCode ?? 0,
              json: text ? JSON.parse(text) : null,
            });
          });
        },
      );
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });
  });
}

describe("related products freshness/discount helpers", () => {
  it("computes freshness with 24h TTL and preserves stale amounts", () => {
    const now = Date.parse("2026-08-09T12:00:00.000Z");
    const freshAt = new Date(now - 60 * 60 * 1000).toISOString();
    const staleAt = new Date(now - RELATED_PRICE_FRESHNESS_TTL_MS - 1000).toISOString();
    const money = { amountMinor: 100, currency: "JPY", taxStatus: "included" as const };

    assert.equal(computeFreshness(freshAt, money, null, now), "fresh");
    assert.equal(computeFreshness(staleAt, money, null, now), "stale");
    assert.equal(computeFreshness(null, money, null, now), "unavailable");
    assert.equal(computeFreshness(freshAt, null, null, now), "unavailable");

    const stalePrice = buildMarketOfferPrice(
      {
        current: money,
        regular: null,
        observedAt: staleAt,
      },
      now,
    );
    assert.equal(stalePrice.freshness, "stale");
    assert.equal(stalePrice.current?.amountMinor, 100);
    assert.equal(stalePrice.observedAt, staleAt);
  });

  it("derives discount only with matching currency/taxStatus", () => {
    assert.equal(
      resolveDiscountPercent(
        { amountMinor: 800, currency: "JPY", taxStatus: "included" },
        { amountMinor: 1000, currency: "JPY", taxStatus: "included" },
        null,
      ),
      20,
    );
    assert.equal(
      resolveDiscountPercent(
        { amountMinor: 800, currency: "JPY", taxStatus: "included" },
        { amountMinor: 1000, currency: "JPY", taxStatus: "excluded" },
        null,
      ),
      null,
    );
    assert.equal(
      resolveDiscountPercent(
        { amountMinor: 800, currency: "JPY", taxStatus: "included" },
        { amountMinor: 1000, currency: "JPY", taxStatus: "included" },
        15.5,
      ),
      15.5,
    );
  });
});

describe("related products import + query service", () => {
  let db: DatabaseSync;

  before(() => {
    db = openDatabase(":memory:").sqlite;
    seedAnchor(db);
  });

  after(() => {
    // memory db; nothing to close via wrapper here
  });

  it("imports synthetic fixture without writing listings", () => {
    const listingCountBefore = (
      db.prepare(`SELECT COUNT(*) AS n FROM listing`).get() as { n: number }
    ).n;

    const req = loadSyntheticImport();
    const observedAt = "2026-08-09T10:00:00.000Z";
    const result = importRelatedProducts(db, req, observedAt);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.result.edgesUpserted >= 4);
    assert.equal(result.result.offersUpserted, 4);

    const listingCountAfter = (
      db.prepare(`SELECT COUNT(*) AS n FROM listing`).get() as { n: number }
    ).n;
    assert.equal(listingCountAfter, listingCountBefore);

    const offerOwned = db
      .prepare(`SELECT 1 FROM listing WHERE source = 'dlsite' AND cid = 'RJ900101'`)
      .get();
    assert.equal(offerOwned, undefined);
  });

  it("rejects owned products as market offers", () => {
    const req = loadSyntheticImport();
    req.items = [
      {
        product: {
          source: "dlsite",
          cid: "RJ000001",
          title: "アンカー自身",
          maker: "合成サークル",
          seriesId: null,
          imageUrl: null,
          productUrl: null,
        },
        evidence: [
          {
            kind: "maker",
            origin: "derived",
            anchorValue: "合成サークル",
            productValue: "合成サークル",
          },
        ],
        price: { current: null, regular: null },
        availability: "unknown",
      },
    ];
    const result = importRelatedProducts(db, req);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, "invalid_request");
  });

  it("rejects DLsite case-variant owned cid as market offer", () => {
    // Owned listing is RJ000001 (canonical upper). Import must normalize
    // lowercase/variant cids before owned rejection so ownership separation holds.
    const req = loadSyntheticImport();
    req.items = [
      {
        product: {
          source: "dlsite",
          cid: "rj000001",
          title: "アンカー自身（大小文字ゆれ）",
          maker: "合成サークル",
          seriesId: null,
          imageUrl: null,
          productUrl: null,
        },
        evidence: [
          {
            kind: "maker",
            origin: "derived",
            anchorValue: "合成サークル",
            productValue: "合成サークル",
          },
        ],
        price: { current: null, regular: null },
        availability: "unknown",
      },
    ];
    const result = importRelatedProducts(db, req);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.error, "invalid_request");

    const nonCanonicalOffer = db
      .prepare(
        `SELECT 1 FROM market_offer WHERE source = 'dlsite' AND cid = 'rj000001'`,
      )
      .get();
    assert.equal(nonCanonicalOffer, undefined);
    const edges = db
      .prepare(
        `SELECT 1 FROM related_edge
         WHERE product_source = 'dlsite' AND product_cid = 'rj000001'`,
      )
      .get();
    assert.equal(edges, undefined);
  });

  it("returns relation evidence, price states, and owned exclusion", () => {
    // Re-import with controlled observation times.
    const base = loadSyntheticImport();
    const now = Date.parse("2026-08-09T12:00:00.000Z");
    const freshAt = new Date(now - 60 * 60 * 1000).toISOString();
    const staleAt = new Date(now - RELATED_PRICE_FRESHNESS_TTL_MS - 60_000).toISOString();

    // Import first three items as fresh, then overwrite stale item.
    importRelatedProducts(db, { ...base, items: base.items.slice(0, 2) }, freshAt);
    importRelatedProducts(
      db,
      {
        ...base,
        complete: false,
        items: [base.items[2]!],
      },
      staleAt,
    );
    importRelatedProducts(
      db,
      {
        ...base,
        complete: false,
        items: [base.items[3]!],
      },
      freshAt,
    );

    // Seed a possible_duplicate owned listing (exact title+maker, other source).
    db.prepare("INSERT INTO work DEFAULT VALUES").run();
    const workId = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id);
    db.prepare(
      `INSERT INTO listing (
        source, cid, work_id, title, maker_name, series_id, image_url,
        purchased_at, purchased_at_precision, raw_json, imported_at
      ) VALUES ('fanza_doujin', 'd_owned_dup', ?, '合成・ストア関連セール作品', '別サークル',
        NULL, NULL, NULL, 'unknown', '{}', ?)`,
    ).run(workId, new Date().toISOString());
    const ownedId = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id);
    recomputeMatchKeys(db, ownedId);

    const excluded = getRelatedProducts(
      db,
      {
        anchorSource: "dlsite",
        anchorCid: "RJ000001",
        owned: "exclude",
        sort: "relevance",
      },
      now,
    );
    assert.equal(excluded.ok, true);
    if (!excluded.ok) return;
    const excludedCids = excluded.response.items.map((i) => i.product.cid);
    assert.ok(excludedCids.includes("RJ900101"));
    assert.ok(excludedCids.includes("RJ900404"));
    assert.ok(excludedCids.includes("b_rel_stale_1"));
    // possible_duplicate sale item excluded by default
    assert.ok(!excludedCids.includes("d_rel_sale_1"));

    const marked = getRelatedProducts(
      db,
      {
        anchorSource: "dlsite",
        anchorCid: "RJ000001",
        owned: "mark",
        sort: "relevance",
      },
      now,
    );
    assert.equal(marked.ok, true);
    if (!marked.ok) return;
    const sale = marked.response.items.find((i) => i.product.cid === "d_rel_sale_1");
    assert.ok(sale);
    assert.equal(sale?.ownership.status, "possible_duplicate");
    assert.equal(sale?.ownership.matchedBy, "title_maker");
    assert.ok(sale?.relation.evidence.some((e) => e.kind === "store_related"));
    assert.equal(sale?.price.freshness, "fresh");
    // Derived discount from 550/1100
    assert.equal(sale?.price.discountPercent, 50);

    const stale = marked.response.items.find((i) => i.product.cid === "b_rel_stale_1");
    assert.equal(stale?.price.freshness, "stale");
    assert.equal(stale?.price.current?.amountMinor, 990);
    assert.equal(stale?.price.current?.taxStatus, "excluded");
    assert.equal(stale?.price.observedAt, staleAt);
    assert.ok(stale?.relation.evidence.some((e) => e.kind === "series"));
    assert.ok(stale?.relation.evidence.some((e) => e.kind === "author"));

    const noPrice = marked.response.items.find((i) => i.product.cid === "RJ900404");
    assert.equal(noPrice?.price.freshness, "unavailable");
    assert.equal(noPrice?.price.current, null);
    assert.equal(noPrice?.price.regular, null);

    // store_related ranks above maker
    assert.equal(marked.response.items[0]?.product.cid, "d_rel_sale_1");
  });

  it("does not invent saleEndsAt or discount without evidence", () => {
    const now = Date.parse("2026-08-09T12:00:00.000Z");
    const result = getRelatedProducts(
      db,
      {
        anchorSource: "dlsite",
        anchorCid: "RJ000001",
        owned: "mark",
      },
      now,
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const stale = result.response.items.find((i) => i.product.cid === "b_rel_stale_1");
    assert.equal(stale?.price.saleEndsAt, null);
    assert.equal(stale?.price.discountPercent, null);
  });
});

describe("related products HTTP routes", () => {
  let db: DatabaseSync;
  let server: Server;
  let port: number;

  before(async () => {
    db = openDatabase(":memory:").sqlite;
    seedAnchor(db);
    const fixture = loadSyntheticImport();
    importRelatedProducts(db, fixture, "2026-08-09T10:00:00.000Z");
    const started = await startServer(db);
    server = started.server;
    port = started.port;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("GET /api/related-products returns validated response", async () => {
    const res = await request(
      port,
      "/api/related-products?anchorSource=dlsite&anchorCid=RJ000001&owned=exclude",
    );
    assert.equal(res.status, 200);
    const body = RelatedProductsResponseSchema.parse(res.json);
    assert.equal(body.anchor.cid, "RJ000001");
    assert.ok(body.items.length >= 1);
    for (const item of body.items) {
      assert.ok(item.relation.evidence.length >= 1);
      for (const e of item.relation.evidence) {
        assert.ok(["maker", "author", "series", "store_related"].includes(e.kind));
      }
      assert.notEqual(item.ownership.status, "owned");
    }
  });

  it("GET 404 when anchor listing missing", async () => {
    const res = await request(
      port,
      "/api/related-products?anchorSource=dlsite&anchorCid=RJ_MISSING",
    );
    assert.equal(res.status, 404);
  });

  it("POST /api/import/related rejects non-synthetic payloads", async () => {
    const res = await request(port, "/api/import/related", {
      method: "POST",
      body: {
        anchor: { source: "dlsite", cid: "RJ000001" },
        payload: { invent: true },
        complete: true,
      },
    });
    assert.equal(res.status, 400);
  });

  it("POST /api/import/related accepts synthetic contract", async () => {
    const fixture = loadSyntheticImport();
    fixture.items = fixture.items.slice(0, 1);
    fixture.complete = false;
    const res = await request(port, "/api/import/related", {
      method: "POST",
      body: fixture,
    });
    assert.equal(res.status, 200);
    const body = res.json as {
      edgesUpserted: number;
      offersUpserted: number;
    };
    assert.ok(body.edgesUpserted >= 1);
    assert.equal(body.offersUpserted, 1);
  });

  it("does not break GET /api/listings (#42/#45 surface)", async () => {
    const res = await request(port, "/api/listings?limit=10");
    assert.equal(res.status, 200);
    const body = res.json as { listings: unknown[] };
    assert.ok(Array.isArray(body.listings));
    assert.ok(body.listings.length >= 1);
  });
});
