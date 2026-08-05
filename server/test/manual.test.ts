import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { openDatabase } from "../src/db.js";
import { handleApi } from "../src/http.js";
import { runRematch } from "../src/services/lookup.js";
import type { DatabaseSync } from "node:sqlite";
import { parseManualProductUrl } from "../src/routes/manual.js";
import { createProductionProductFetcher } from "../src/static.js";
import "../src/routes/manual.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");
const TEST_EXTENSION_ORIGIN = "chrome-extension://test-extension";
const TEST_EXTENSION_ORIGINS = new Set([TEST_EXTENSION_ORIGIN]);

function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    import("node:http").then(({ request: httpRequest }) => {
      const r = httpRequest(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method,
          headers: {
            Origin: TEST_EXTENSION_ORIGIN,
            ...(payload !== undefined
              ? {
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(payload),
                }
              : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            resolve({
              status: res.statusCode ?? 0,
              json: text.length ? JSON.parse(text) : null,
            });
          });
        },
      );
      r.on("error", reject);
      if (payload !== undefined) r.write(payload);
      r.end();
    });
  });
}

function startTestServer(
  db: DatabaseSync,
  productFetcher?: (workno: string) => Promise<unknown | null>,
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    let listenPort = 0;
    const server = createServer(async (req, res) => {
      await handleApi(req, res, {
        db,
        port: listenPort,
        extensionOrigins: TEST_EXTENSION_ORIGINS,
        productFetcher,
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      listenPort = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port: listenPort });
    });
    server.on("error", reject);
  });
}

function insertLockedListing(db: DatabaseSync): void {
  db.prepare("INSERT INTO work DEFAULT VALUES").run();
  const workId = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id);
  db.prepare(
    `INSERT INTO listing (
      source, cid, work_id, work_id_locked, title, maker_name, series_id, image_url,
      purchased_at, purchased_at_precision, raw_json, imported_at
    ) VALUES ('dlsite', 'RJ900001', ?, 1, 'Locked Title', 'Maker', NULL, NULL, NULL, 'unknown', '{}', ?)`,
  ).run(workId, new Date().toISOString());
}

describe("manual listing URL contract", () => {
  it("parses supported product URLs into canonical (source, cid)", () => {
    assert.deepEqual(
      parseManualProductUrl(
        "https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html",
      ),
      { source: "dlsite", cid: "RJ123456" },
    );
    assert.deepEqual(
      parseManualProductUrl(
        "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_123456/",
      ),
      { source: "fanza_doujin", cid: "d_123456" },
    );
    assert.deepEqual(
      parseManualProductUrl("https://book.dmm.co.jp/product/12345/b100xx001/"),
      { source: "fanza_books", cid: "b100xx001", seriesId: "12345" },
    );
    assert.deepEqual(
      parseManualProductUrl("https://video.dmm.co.jp/av/content/?id=abc123"),
      { source: "fanza_video", cid: "abc123", videoFloor: "av" },
    );
    assert.deepEqual(
      parseManualProductUrl("https://dlsoft.dmm.co.jp/detail/game001/"),
      { source: "fanza_dlsoft", cid: "game001" },
    );
    assert.equal(parseManualProductUrl("https://example.com/no-cid"), null);
  });

  it("rejects spoof hosts, http, userinfo, query/path injection, and malformed segments", () => {
    const rejected = [
      // evil host with product-shaped query/path (href substring spoof)
      "https://evil.example/?q=https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html",
      "https://evil.example/path/product_id/RJ123456",
      "https://evil.example/maniax/work/=/product_id/RJ123456.html",
      "https://evil.example/dc/doujin/-/detail/=/cid=d_900001/",
      "https://evil.example/product/100001/b100xxxxx01001/",
      // hostname suffix lookalikes
      "https://www.dlsite.com.evil.example/maniax/work/=/product_id/RJ123456.html",
      "https://www.dmm.co.jp.evil.example/dc/doujin/-/detail/=/cid=d_900001/",
      "https://book.dmm.co.jp.evil.example/product/100001/b100xxxxx01001/",
      "https://video.dmm.co.jp.evil.example/av/content/?id=abc123",
      "https://dlsoft.dmm.co.jp.evil.example/detail/game001/",
      // http (not https)
      "http://www.dlsite.com/maniax/work/=/product_id/RJ123456.html",
      "http://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_900001/",
      "http://book.dmm.co.jp/product/100001/b100xxxxx01001/",
      "http://video.dmm.co.jp/av/content/?id=abc123",
      "http://dlsoft.dmm.co.jp/detail/game001/",
      // userinfo
      "https://user:pass@www.dlsite.com/maniax/work/=/product_id/RJ123456.html",
      "https://user@book.dmm.co.jp/product/12345/b100xx001/",
      // disallowed query on non-video stores / extra video query
      "https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html?evil=1",
      "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_123456/?x=1",
      "https://book.dmm.co.jp/product/12345/b100xx001/?x=1",
      "https://dlsoft.dmm.co.jp/detail/game001/?x=1",
      "https://video.dmm.co.jp/av/content/?id=abc123&other=1",
      // extra path suffix
      "https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html/extra",
      "https://dlsoft.dmm.co.jp/detail/game001/extra",
      "https://book.dmm.co.jp/product/12345/b100xx001/extra",
      "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_123456/extra",
      "https://video.dmm.co.jp/av/content/extra/?id=abc123",
      // malformed percent / encoded delimiters in cid segments
      "https://www.dlsite.com/maniax/work/=/product_id/RJ%2F123.html",
      "https://www.dlsite.com/maniax/work/=/product_id/RJ%ZZ1234.html",
      "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_123%2Fevil/",
      "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_123%GGevil/",
      "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_123%2",
      "https://book.dmm.co.jp/product/12345/b100%2Fxx001/",
      "https://dlsoft.dmm.co.jp/detail/game%2F001/",
      "https://video.dmm.co.jp/av/content/?id=abc%2F123",
      "https://video.dmm.co.jp/av/content/?id=abc%2",
      // invalid source-specific cid shape
      "https://www.dlsite.com/maniax/work/=/product_id/XX123456.html",
      "https://www.dlsite.com/maniax/work/=/product_id/RJ12345.html",
    ];
    for (const url of rejected) {
      assert.equal(parseManualProductUrl(url), null, `expected reject: ${url}`);
    }
  });
});

describe("manual listing API", () => {
  let server: Server;
  let port: number;
  let db: DatabaseSync;

  before(async () => {
    db = openDatabase(":memory:").sqlite;
    const productJson = JSON.parse(
      readFileSync(join(FIXTURES, "dlsite-product-rj000001.json"), "utf8"),
    );
    ({ server, port } = await startTestServer(db, async (workno) => {
      if (workno === "RJ000001") return productJson;
      return null;
    }));
  });

  after(() => {
    server.close();
    db.close();
  });

  it("registers DLsite URL with injectable metadata enrichment", async () => {
    const res = await request(port, "POST", "/api/listings/manual", {
      url: "https://www.dlsite.com/maniax/work/=/product_id/RJ000001.html",
    });
    assert.equal(res.status, 201);
    const listing = (res.json as { listing: { cid: string; title: string } }).listing;
    assert.equal(listing.cid, "RJ000001");
    assert.notEqual(listing.title, "RJ000001");
  });

  it("registers FANZA doujin without network and rejects missing cid URLs", async () => {
    const ok = await request(port, "POST", "/api/listings/manual", {
      url: "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_manual_1/",
    });
    assert.equal(ok.status, 201);
    const bad = await request(port, "POST", "/api/listings/manual", {
      url: "https://www.dlsite.com/maniax/work/=/product_id/.html",
    });
    assert.equal(bad.status, 400);
  });

  it("rejects spoof product URLs at the API boundary", async () => {
    const spoofs = [
      "https://evil.example/?q=https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html",
      "https://www.dlsite.com.evil.example/maniax/work/=/product_id/RJ123456.html",
      "http://www.dlsite.com/maniax/work/=/product_id/RJ123456.html",
      "https://user:pass@www.dlsite.com/maniax/work/=/product_id/RJ123456.html",
    ];
    for (const url of spoofs) {
      const res = await request(port, "POST", "/api/listings/manual", { url });
      assert.equal(res.status, 400, `expected 400 for ${url}`);
    }
  });
});

describe("production productFetcher wiring (stubbed, no live network)", () => {
  it("enriches title/maker/image/raw evidence via production fetcher factory", async () => {
    const productJson = JSON.parse(
      readFileSync(join(FIXTURES, "dlsite-product-rj000001.json"), "utf8"),
    ) as Array<Record<string, unknown>>;
    const workno = "RJ000001";
    let fetchCalls = 0;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      fetchCalls += 1;
      const href = String(input);
      assert.match(href, /product\.json/);
      assert.match(href, new RegExp(`workno=${workno}`));
      assert.match(href, /^https:\/\/www\.dlsite\.com\//);
      return new Response(JSON.stringify(productJson), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const productFetcher = createProductionProductFetcher(fetchImpl);
    const db = openDatabase(":memory:").sqlite;
    const { server, port } = await startTestServer(db, productFetcher);
    try {
      const res = await request(port, "POST", "/api/listings/manual", {
        url: `https://www.dlsite.com/maniax/work/=/product_id/${workno}.html`,
      });
      assert.equal(res.status, 201);
      assert.equal(fetchCalls, 1);
      const listing = (
        res.json as {
          listing: {
            cid: string;
            title: string;
            maker: string | null;
            imageUrl: string | null;
          };
        }
      ).listing;
      assert.equal(listing.cid, workno);
      assert.equal(listing.title, "テスト作品A");
      assert.equal(listing.maker, "サークルA");
      assert.equal(
        listing.imageUrl,
        "https://img.dlsite.com/modpub/images2/work/doujin/example.jpg",
      );

      const row = db
        .prepare("SELECT title, maker_name, image_url, raw_json FROM listing WHERE cid = ?")
        .get(workno) as {
        title: string;
        maker_name: string | null;
        image_url: string | null;
        raw_json: string;
      };
      assert.equal(row.title, "テスト作品A");
      assert.equal(row.maker_name, "サークルA");
      assert.equal(
        row.image_url,
        "https://img.dlsite.com/modpub/images2/work/doujin/example.jpg",
      );
      const raw = JSON.parse(row.raw_json) as {
        manual: boolean;
        product: Record<string, unknown>;
      };
      assert.equal(raw.manual, true);
      assert.equal(raw.product.workno, workno);
      assert.equal(raw.product.work_name, "テスト作品A");
      assert.equal(raw.product.maker_name, "サークルA");
    } finally {
      server.close();
      db.close();
    }
  });

  it("falls back without breaking registration on network/non-2xx/invalid JSON", async () => {
    const cases: Array<{
      name: string;
      fetchImpl: typeof fetch;
    }> = [
      {
        name: "network error",
        fetchImpl: (async () => {
          throw new Error("network down");
        }) as typeof fetch,
      },
      {
        name: "non-2xx",
        fetchImpl: (async () =>
          new Response("nope", { status: 503 })) as typeof fetch,
      },
      {
        name: "invalid JSON",
        fetchImpl: (async () =>
          new Response("{not-json", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })) as typeof fetch,
      },
    ];

    for (const [index, c] of cases.entries()) {
      const workno = `RJ00010${index}`;
      const productFetcher = createProductionProductFetcher(c.fetchImpl);
      const db = openDatabase(":memory:").sqlite;
      const { server, port } = await startTestServer(db, productFetcher);
      try {
        const res = await request(port, "POST", "/api/listings/manual", {
          url: `https://www.dlsite.com/maniax/work/=/product_id/${workno}.html`,
        });
        assert.equal(res.status, 201, c.name);
        const listing = (res.json as { listing: { cid: string; title: string } })
          .listing;
        assert.equal(listing.cid, workno, c.name);
        assert.equal(listing.title, workno, c.name);
        const row = db
          .prepare("SELECT raw_json FROM listing WHERE cid = ?")
          .get(workno) as { raw_json: string };
        const raw = JSON.parse(row.raw_json) as { manual: boolean; cid: string };
        assert.equal(raw.manual, true, c.name);
        assert.equal(raw.cid, workno, c.name);
      } finally {
        server.close();
        db.close();
      }
    }
  });
});

describe("rematch idempotency with locked listings", () => {
  let db: DatabaseSync;

  before(() => {
    db = openDatabase(":memory:").sqlite;
    insertLockedListing(db);
  });

  after(() => {
    db.close();
  });

  it("is repeatable and leaves work_id_locked rows unchanged", () => {
    const before = db
      .prepare("SELECT work_id, work_id_locked FROM listing WHERE cid = 'RJ900001'")
      .get() as { work_id: number; work_id_locked: number };
    const first = runRematch(db);
    const second = runRematch(db);
    const after = db
      .prepare("SELECT work_id, work_id_locked FROM listing WHERE cid = 'RJ900001'")
      .get() as { work_id: number; work_id_locked: number };
    assert.deepEqual(first, second);
    assert.equal(after.work_id_locked, 1);
    assert.equal(after.work_id, before.work_id);
  });
});
