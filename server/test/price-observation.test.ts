import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/db.js";
import { handleApi } from "../src/http.js";
import { seedDlsiteFromSales } from "../src/services/import.js";
import {
  loadPriceObservation,
  pageUrlMatchesListing,
  upsertPriceObservation,
} from "../src/services/price-observation.js";
import "../src/routes/listings.js";
import "../src/routes/price-observation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

const MONEY = {
  amountMinor: 1100,
  currency: "JPY",
  taxStatus: "unknown" as const,
};

function seedOne(db: DatabaseSync): void {
  const sales = JSON.parse(readFileSync(join(FIXTURES, "dlsite-sales.json"), "utf8"));
  const product = JSON.parse(
    readFileSync(join(FIXTURES, "dlsite-product-rj000001.json"), "utf8"),
  );
  seedDlsiteFromSales(db, sales.slice(0, 1), { RJ000001: product });
}

function seedFanzaListing(
  db: DatabaseSync,
  input: {
    source: "fanza_doujin" | "fanza_books";
    cid: string;
    seriesId: string | null;
  },
): void {
  db.prepare("INSERT INTO work DEFAULT VALUES").run();
  const workId = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id);
  db.prepare(
    `INSERT INTO listing (
      source, cid, work_id, title, maker_name, series_id, image_url,
      purchased_at, purchased_at_precision, raw_json, imported_at
    ) VALUES (?, ?, ?, ?, NULL, ?, NULL, NULL, 'unknown', '{}', ?)`,
  ).run(input.source, input.cid, workId, "合成テスト商品", input.seriesId, new Date().toISOString());
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

describe("price observation service", () => {
  let db: DatabaseSync;

  before(() => {
    db = openDatabase(":memory:").sqlite;
    seedOne(db);
    seedFanzaListing(db, {
      source: "fanza_doujin",
      cid: "d_900001",
      seriesId: null,
    });
    seedFanzaListing(db, {
      source: "fanza_books",
      cid: "b100xxxxx01001",
      seriesId: "100001",
    });
  });

  it("matches only canonical product page URLs for the listing CID", () => {
    const listing = {
      id: 1,
      source: "dlsite" as const,
      cid: "RJ000001",
      series_id: null,
      raw_json: "{}",
    };
    assert.equal(
      pageUrlMatchesListing(
        "https://www.dlsite.com/maniax/work/=/product_id/RJ000001.html",
        listing,
      ),
      true,
    );
    assert.equal(
      pageUrlMatchesListing(
        "https://www.dlsite.com/maniax/work/=/product_id/RJ999999.html",
        listing,
      ),
      false,
    );
    assert.equal(
      pageUrlMatchesListing(
        "https://user:pass@www.dlsite.com/maniax/work/=/product_id/RJ000001.html",
        listing,
      ),
      false,
    );
    // Wrong floor for RJ (canonical is maniax, not pro/books/home).
    assert.equal(
      pageUrlMatchesListing(
        "https://www.dlsite.com/pro/work/=/product_id/RJ000001.html",
        listing,
      ),
      false,
    );
    assert.equal(
      pageUrlMatchesListing(
        "https://www.dlsite.com/books/work/=/product_id/RJ000001.html",
        listing,
      ),
      false,
    );
    assert.equal(
      pageUrlMatchesListing(
        "https://www.dlsite.com/home/work/=/product_id/RJ000001.html",
        listing,
      ),
      false,
    );
  });

  it("rejects wrong-floor DLsite URLs without creating or mutating unowned listings", () => {
    const before = db
      .prepare("SELECT COUNT(*) AS c FROM price_observation")
      .get() as { c: number };
    const listingCountBefore = db
      .prepare("SELECT COUNT(*) AS c FROM listing")
      .get() as { c: number };

    const wrongFloor = upsertPriceObservation(db, {
      source: "dlsite",
      cid: "RJ000001",
      pageUrl: "https://www.dlsite.com/pro/work/=/product_id/RJ000001.html",
      regular: MONEY,
      sale: null,
      coupon: null,
    });
    assert.deepEqual(wrongFloor, { ok: false, error: "invalid_page" });

    const unowned = upsertPriceObservation(db, {
      source: "dlsite",
      cid: "RJ_NOT_OWNED",
      pageUrl: "https://www.dlsite.com/maniax/work/=/product_id/RJ_NOT_OWNED.html",
      regular: MONEY,
      sale: null,
      coupon: null,
    });
    assert.deepEqual(unowned, { ok: false, error: "not_found" });

    const after = db
      .prepare("SELECT COUNT(*) AS c FROM price_observation")
      .get() as { c: number };
    const listingCountAfter = db
      .prepare("SELECT COUNT(*) AS c FROM listing")
      .get() as { c: number };
    assert.equal(after.c, before.c, "wrong-floor must not write price_observation");
    assert.equal(
      listingCountAfter.c,
      listingCountBefore.c,
      "must not create listings from price observation",
    );
  });

  it("rejects query/hash on DLsite and FANZA product URLs (fail closed)", () => {
    const dlsite = {
      id: 1,
      source: "dlsite" as const,
      cid: "RJ000001",
      series_id: null,
      raw_json: "{}",
    };
    const fanzaDoujin = {
      id: 2,
      source: "fanza_doujin" as const,
      cid: "d_900001",
      series_id: null,
      raw_json: "{}",
    };
    const fanzaBooks = {
      id: 3,
      source: "fanza_books" as const,
      cid: "b100xxxxx01001",
      series_id: "100001",
      raw_json: "{}",
    };

    const baseDlsite = "https://www.dlsite.com/maniax/work/=/product_id/RJ000001.html";
    const baseDoujin = "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_900001/";
    const baseBooks = "https://book.dmm.co.jp/product/100001/b100xxxxx01001/";

    // Canonical forms still match.
    assert.equal(pageUrlMatchesListing(baseDlsite, dlsite), true);
    assert.equal(pageUrlMatchesListing(baseDoujin, fanzaDoujin), true);
    assert.equal(pageUrlMatchesListing(baseBooks, fanzaBooks), true);

    for (const [url, listing] of [
      [`${baseDlsite}?utm_source=x`, dlsite],
      [`${baseDlsite}#frag`, dlsite],
      [`${baseDlsite}?code=REDACTED#top`, dlsite],
      [`${baseDoujin}?utm_source=x`, fanzaDoujin],
      [`${baseDoujin}#section`, fanzaDoujin],
      [
        "https://user:pass@www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_900001/",
        fanzaDoujin,
      ],
      [`${baseBooks}?ref=tracking`, fanzaBooks],
      [`${baseBooks}#detail`, fanzaBooks],
      [
        "https://user:pass@book.dmm.co.jp/product/100001/b100xxxxx01001/",
        fanzaBooks,
      ],
    ] as const) {
      assert.equal(pageUrlMatchesListing(url, listing), false, url);
    }

    const rejected = upsertPriceObservation(db, {
      source: "dlsite",
      cid: "RJ000001",
      pageUrl: `${baseDlsite}?utm_source=tracking`,
      regular: MONEY,
      sale: null,
      coupon: null,
    });
    assert.deepEqual(rejected, { ok: false, error: "invalid_page" });
  });

  it("fails closed without throwing on malformed FANZA percent-encoding", () => {
    const fanzaDoujin = {
      id: 2,
      source: "fanza_doujin" as const,
      cid: "d_900001",
      series_id: null,
      raw_json: "{}",
    };
    const fanzaBooks = {
      id: 3,
      source: "fanza_books" as const,
      cid: "b100xxxxx01001",
      series_id: "100001",
      raw_json: "{}",
    };

    const malformed = [
      [
        "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_%ZZ900001/",
        fanzaDoujin,
      ],
      [
        "https://book.dmm.co.jp/product/100001/b100xxxxx0100%ZZ/",
        fanzaBooks,
      ],
      [
        "https://book.dmm.co.jp/product/100%ZZ1/b100xxxxx01001/",
        fanzaBooks,
      ],
    ] as const;

    for (const [url, listing] of malformed) {
      let matched: boolean | undefined;
      assert.doesNotThrow(() => {
        matched = pageUrlMatchesListing(url, listing);
      }, url);
      assert.equal(matched, false, url);

      const result = upsertPriceObservation(db, {
        source: listing.source,
        cid: listing.cid,
        pageUrl: url,
        regular: MONEY,
        sale: null,
        coupon: null,
      });
      assert.deepEqual(result, { ok: false, error: "invalid_page" }, url);
    }
  });

  it("updates only owned listings and keeps purchasePrice out of the observation", () => {
    const ok = upsertPriceObservation(db, {
      source: "dlsite",
      cid: "RJ000001",
      pageUrl: "https://www.dlsite.com/maniax/work/=/product_id/RJ000001.html",
      regular: MONEY,
      sale: { ...MONEY, amountMinor: 880 },
      coupon: { ...MONEY, amountMinor: 770, taxStatus: "included" },
    });
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.equal(ok.priceObservation.regular?.amountMinor, 1100);
    assert.equal(ok.priceObservation.sale?.amountMinor, 880);
    assert.equal(ok.priceObservation.coupon?.amountMinor, 770);

    const missing = upsertPriceObservation(db, {
      source: "dlsite",
      cid: "RJ_NOT_OWNED",
      pageUrl: "https://www.dlsite.com/maniax/work/=/product_id/RJ_NOT_OWNED.html",
      regular: MONEY,
      sale: null,
      coupon: null,
    });
    assert.deepEqual(missing, { ok: false, error: "not_found" });

    const listingRow = db
      .prepare("SELECT id FROM listing WHERE source = 'dlsite' AND cid = 'RJ000001'")
      .get() as { id: number };
    // Observations live only on price_observation — not as paid purchasePrice.
    const listingCols = (
      db.prepare("PRAGMA table_info(listing)").all() as Array<{ name: string }>
    ).map((c) => c.name);
    assert.equal(listingCols.includes("purchase_price"), false);
    assert.ok(
      (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='price_observation'")
          .get() as { name: string } | undefined
      )?.name,
    );
    assert.ok(loadPriceObservation(db, listingRow.id));
  });

  it("preserves observation across a normal dlsite re-import", () => {
    const before = db
      .prepare(
        `SELECT po.regular_amount_minor AS amt
         FROM price_observation po
         JOIN listing l ON l.id = po.listing_id
         WHERE l.source = 'dlsite' AND l.cid = 'RJ000001'`,
      )
      .get() as { amt: number };

    const sales = JSON.parse(readFileSync(join(FIXTURES, "dlsite-sales.json"), "utf8"));
    const product = JSON.parse(
      readFileSync(join(FIXTURES, "dlsite-product-rj000001.json"), "utf8"),
    );
    // Mutate title evidence on re-import.
    const productArr = product as Array<Record<string, unknown>>;
    productArr[0] = { ...productArr[0], work_name: "再インポート後タイトル" };
    seedDlsiteFromSales(db, sales.slice(0, 1), { RJ000001: productArr });

    const after = db
      .prepare(
        `SELECT po.regular_amount_minor AS amt, l.title AS title
         FROM price_observation po
         JOIN listing l ON l.id = po.listing_id
         WHERE l.source = 'dlsite' AND l.cid = 'RJ000001'`,
      )
      .get() as { amt: number; title: string };
    assert.equal(after.amt, before.amt);
    assert.equal(after.title, "再インポート後タイトル");
  });
});

describe("price observation HTTP + listings API", () => {
  let db: DatabaseSync;
  let server: Server;
  let port: number;

  before(async () => {
    db = openDatabase(":memory:").sqlite;
    seedOne(db);
    seedFanzaListing(db, {
      source: "fanza_doujin",
      cid: "d_900001",
      seriesId: null,
    });
    seedFanzaListing(db, {
      source: "fanza_books",
      cid: "b100xxxxx01001",
      seriesId: "100001",
    });
    ({ server, port } = await startServer(db));
  });

  after(() => {
    server.close();
  });

  it("accepts owned observation and surfaces tiers on GET /api/listings", async () => {
    const post = await request(port, "/api/listings/price-observation", {
      method: "POST",
      body: {
        source: "dlsite",
        cid: "RJ000001",
        pageUrl: "https://www.dlsite.com/maniax/work/=/product_id/RJ000001.html",
        regular: MONEY,
        sale: null,
        coupon: { amountMinor: 700, currency: "JPY", taxStatus: "included" },
      },
    });
    assert.equal(post.status, 200);
    const body = post.json as {
      ok: boolean;
      priceObservation: { observedAt: string; coupon: { amountMinor: number } };
    };
    assert.equal(body.ok, true);
    assert.match(body.priceObservation.observedAt, /Z$/);
    assert.equal(body.priceObservation.coupon.amountMinor, 700);

    const badCid = await request(port, "/api/listings/price-observation", {
      method: "POST",
      body: {
        source: "dlsite",
        cid: "RJ000001",
        pageUrl: "https://www.dlsite.com/maniax/work/=/product_id/RJ999999.html",
        regular: MONEY,
        sale: null,
        coupon: null,
      },
    });
    assert.equal(badCid.status, 400);

    const list = await request(port, "/api/listings?source=dlsite");
    assert.equal(list.status, 200);
    const listings = (list.json as { listings: Array<Record<string, unknown>> }).listings;
    const row = listings.find((l) => l.cid === "RJ000001");
    assert.ok(row);
    assert.equal(row.purchasePrice, null);
    const obs = row.priceObservation as {
      regular: { amountMinor: number };
      sale: null;
      coupon: { amountMinor: number };
    };
    assert.equal(obs.regular.amountMinor, 1100);
    assert.equal(obs.sale, null);
    assert.equal(obs.coupon.amountMinor, 700);
  });

  it("returns 400 invalid_page for malformed FANZA percent-encoding", async () => {
    const malformed = [
      {
        source: "fanza_doujin",
        cid: "d_900001",
        pageUrl: "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_%ZZ900001/",
      },
      {
        source: "fanza_books",
        cid: "b100xxxxx01001",
        pageUrl: "https://book.dmm.co.jp/product/100001/b100xxxxx0100%ZZ/",
      },
      {
        source: "fanza_books",
        cid: "b100xxxxx01001",
        pageUrl: "https://book.dmm.co.jp/product/100%ZZ1/b100xxxxx01001/",
      },
    ] as const;

    for (const input of malformed) {
      const res = await request(port, "/api/listings/price-observation", {
        method: "POST",
        body: {
          ...input,
          regular: null,
          sale: null,
          coupon: null,
        },
      });
      assert.equal(res.status, 400, input.pageUrl);
      assert.deepEqual(res.json, { error: "invalid_page" }, input.pageUrl);
    }
  });

  it("rejects unowned source/cid pairs without creating a listing", async () => {
    const before = (
      db.prepare("SELECT COUNT(*) AS n FROM listing").get() as { n: number }
    ).n;
    const res = await request(port, "/api/listings/price-observation", {
      method: "POST",
      body: {
        source: "dlsite",
        cid: "RJ888888",
        pageUrl: "https://www.dlsite.com/maniax/work/=/product_id/RJ888888.html",
        regular: MONEY,
        sale: null,
        coupon: null,
      },
    });
    assert.equal(res.status, 404);
    const after = (
      db.prepare("SELECT COUNT(*) AS n FROM listing").get() as { n: number }
    ).n;
    assert.equal(after, before);
  });

  it("rejects invalid currency / tax / non-JPY observation payloads fail-closed", async () => {
    const cases = [
      {
        regular: { amountMinor: 1000, currency: "usd", taxStatus: "unknown" },
        label: "lowercase currency",
      },
      {
        regular: { amountMinor: 1000, currency: "USD", taxStatus: "unknown" },
        label: "non-JPY currency",
      },
      {
        regular: { amountMinor: 1000, currency: "JPY", taxStatus: "taxed" },
        label: "invented taxStatus",
      },
      {
        regular: { amountMinor: -1, currency: "JPY", taxStatus: "unknown" },
        label: "negative amount",
      },
    ] as const;

    for (const c of cases) {
      const res = await request(port, "/api/listings/price-observation", {
        method: "POST",
        body: {
          source: "dlsite",
          cid: "RJ000001",
          pageUrl: "https://www.dlsite.com/maniax/work/=/product_id/RJ000001.html",
          regular: c.regular,
          sale: null,
          coupon: null,
        },
      });
      assert.equal(res.status, 400, c.label);
      assert.deepEqual(res.json, { error: "invalid_request" }, c.label);
    }
  });

  it("filters and sorts GET /api/listings by stored priceObservation only", async () => {
    // Seed three-tier observations on DLsite + FANZA. purchasePrice/currentPrice stay null.
    const seeds = [
      {
        source: "dlsite" as const,
        cid: "RJ000001",
        pageUrl: "https://www.dlsite.com/maniax/work/=/product_id/RJ000001.html",
        regular: { amountMinor: 2000, currency: "JPY", taxStatus: "unknown" as const },
        sale: { amountMinor: 1500, currency: "JPY", taxStatus: "included" as const },
        coupon: null,
      },
      {
        source: "fanza_doujin" as const,
        cid: "d_900001",
        pageUrl: "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_900001/",
        regular: { amountMinor: 1100, currency: "JPY", taxStatus: "unknown" as const },
        sale: { amountMinor: 880, currency: "JPY", taxStatus: "included" as const },
        coupon: { amountMinor: 770, currency: "JPY", taxStatus: "included" as const },
      },
      {
        source: "fanza_books" as const,
        cid: "b100xxxxx01001",
        pageUrl: "https://book.dmm.co.jp/product/100001/b100xxxxx01001/",
        regular: { amountMinor: 3000, currency: "JPY", taxStatus: "excluded" as const },
        sale: null,
        coupon: null,
      },
    ];
    for (const seed of seeds) {
      const res = await request(port, "/api/listings/price-observation", {
        method: "POST",
        body: seed,
      });
      assert.equal(res.status, 200, seed.cid);
    }

    // Currency filter without tier: any observed JPY tier matches; unobserved rows drop.
    const jpyOnly = await request(port, "/api/listings?priceCurrency=JPY");
    assert.equal(jpyOnly.status, 200);
    const jpyListings = (jpyOnly.json as { listings: Array<{ cid: string; purchasePrice: null; currentPrice: null; priceObservation: unknown }> }).listings;
    assert.equal(jpyListings.length, 3);
    for (const row of jpyListings) {
      assert.equal(row.purchasePrice, null);
      assert.equal(row.currentPrice, null);
      assert.ok(row.priceObservation);
    }

    // Tier-specific filter: sale tier only (fanza_books has regular only → excluded).
    const saleOnly = await request(
      port,
      "/api/listings?priceCurrency=JPY&priceTier=sale",
    );
    assert.equal(saleOnly.status, 200);
    const saleCids = (
      (saleOnly.json as { listings: Array<{ cid: string }> }).listings
    ).map((l) => l.cid);
    assert.deepEqual(saleCids.sort(), ["RJ000001", "d_900001"].sort());

    // Sort ascending by sale observation amount.
    const sortedAsc = await request(
      port,
      "/api/listings?priceCurrency=JPY&priceTier=sale&sort=price_observation_asc",
    );
    assert.equal(sortedAsc.status, 200);
    const ascCids = (
      (sortedAsc.json as { listings: Array<{ cid: string }> }).listings
    ).map((l) => l.cid);
    assert.deepEqual(ascCids, ["d_900001", "RJ000001"]);

    // Sort descending by regular observation.
    const sortedDesc = await request(
      port,
      "/api/listings?priceCurrency=JPY&priceTier=regular&sort=price_observation_desc",
    );
    assert.equal(sortedDesc.status, 200);
    const descCids = (
      (sortedDesc.json as { listings: Array<{ cid: string }> }).listings
    ).map((l) => l.cid);
    assert.deepEqual(descCids, ["b100xxxxx01001", "RJ000001", "d_900001"]);

    // Fail closed: price sort without currency/tier → 400.
    const missingCurrency = await request(
      port,
      "/api/listings?sort=price_observation_asc&priceTier=sale",
    );
    assert.equal(missingCurrency.status, 400);
    const missingTier = await request(
      port,
      "/api/listings?sort=price_observation_desc&priceCurrency=JPY",
    );
    assert.equal(missingTier.status, 400);

    // current_price sorts are not part of the contract.
    const inventedSort = await request(port, "/api/listings?sort=current_price_asc");
    assert.equal(inventedSort.status, 400);
  });
});
