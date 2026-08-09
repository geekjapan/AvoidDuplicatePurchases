import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { openDatabase } from "../src/db.js";
import { handleApi } from "../src/http.js";
import { runRematch } from "../src/services/lookup.js";
import type { DatabaseSync } from "node:sqlite";
import {
  parseManualProductUrl,
  sanitizeProductImageUrl,
} from "../src/routes/manual.js";
import {
  createProductionProductFetcher,
  startServer,
  resolveListenPort,
} from "../src/static.js";
import { loadAdminSettings, persistAdminSettings } from "../src/routes/settings.js";
import { loadConfig } from "../src/config.js";
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

  it("negative matrix: rejects fragment/userinfo/port/spoof/encoded/malformed/Unicode/arbitrary CID for all sources", () => {
    const bases = {
      dlsite: "https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html",
      fanza_doujin: "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_123456/",
      fanza_books: "https://book.dmm.co.jp/product/12345/b100xx001/",
      fanza_video: "https://video.dmm.co.jp/av/content/?id=abc123",
      fanza_dlsoft: "https://dlsoft.dmm.co.jp/detail/game001/",
    } as const;

    const rejected: string[] = [
      // evil host with product-shaped query/path (href substring spoof)
      "https://evil.example/?q=https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html",
      "https://evil.example/path/product_id/RJ123456",
      "https://evil.example/maniax/work/=/product_id/RJ123456.html",
      "https://evil.example/dc/doujin/-/detail/=/cid=d_900001/",
      "https://evil.example/product/100001/b100xxxxx01001/",
      "https://evil.example/av/content/?id=abc123",
      "https://evil.example/detail/game001/",
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
      "https://user:pass@www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_123456/",
      "https://u:p@video.dmm.co.jp/av/content/?id=abc123",
      "https://u@dlsoft.dmm.co.jp/detail/game001/",
      // non-default port
      "https://www.dlsite.com:8443/maniax/work/=/product_id/RJ123456.html",
      "https://www.dmm.co.jp:4430/dc/doujin/-/detail/=/cid=d_123456/",
      "https://book.dmm.co.jp:8080/product/12345/b100xx001/",
      "https://video.dmm.co.jp:8443/av/content/?id=abc123",
      "https://dlsoft.dmm.co.jp:9/detail/game001/",
      // fragments forbidden
      `${bases.dlsite}#frag`,
      `${bases.fanza_doujin}#x`,
      `${bases.fanza_books}#top`,
      `${bases.fanza_video}#clip`,
      `${bases.fanza_dlsoft}#dl`,
      // disallowed query on non-video stores / extra video query
      "https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html?evil=1",
      "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_123456/?x=1",
      "https://book.dmm.co.jp/product/12345/b100xx001/?x=1",
      "https://dlsoft.dmm.co.jp/detail/game001/?x=1",
      "https://video.dmm.co.jp/av/content/?id=abc123&other=1",
      // video id must be exactly one
      "https://video.dmm.co.jp/av/content/",
      "https://video.dmm.co.jp/av/content/?id=abc123&id=def456",
      "https://video.dmm.co.jp/amateur/content/?id=a&id=b",
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
      // Unicode / non-ASCII cid
      "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_あいう/",
      "https://book.dmm.co.jp/product/12345/b100xx%E3%81%82/",
      "https://video.dmm.co.jp/av/content/?id=abc%E3%81%84",
      "https://dlsoft.dmm.co.jp/detail/ゲーム001/",
      // invalid source-specific cid shape / arbitrary junk
      "https://www.dlsite.com/maniax/work/=/product_id/XX123456.html",
      "https://www.dlsite.com/maniax/work/=/product_id/RJ12345.html",
      "https://www.dlsite.com/maniax/work/=/product_id/RJ12345678901.html",
      "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=/",
      "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=..%2Fevil/",
      "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=has space/",
      "https://book.dmm.co.jp/product/12a45/b100xx001/",
      "https://book.dmm.co.jp/product/12345//",
      "https://dlsoft.dmm.co.jp/detail//",
      "https://dlsoft.dmm.co.jp/detail/has space/",
      "https://video.dmm.co.jp/av/content/?id=",
      "https://video.dmm.co.jp/av/content/?id=has%20space",
      "https://video.dmm.co.jp/foo/content/?id=abc123",
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
      "https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html#frag",
      "https://video.dmm.co.jp/av/content/?id=a&id=b",
    ];
    for (const url of spoofs) {
      const res = await request(port, "POST", "/api/listings/manual", { url });
      assert.equal(res.status, 400, `expected 400 for ${url}`);
    }
  });
});

describe("manual re-registration preserves enriched fields (idempotent)", () => {
  it("does not regress title/image/maker/precision/workIdLocked on cid-only re-run", async () => {
    const db = openDatabase(":memory:").sqlite;
    const productJson = JSON.parse(
      readFileSync(join(FIXTURES, "dlsite-product-rj000001.json"), "utf8"),
    );
    const { server, port } = await startTestServer(db, async (workno) => {
      if (workno === "RJ000001") return productJson;
      return null;
    });
    try {
      const first = await request(port, "POST", "/api/listings/manual", {
        url: "https://www.dlsite.com/maniax/work/=/product_id/RJ000001.html",
      });
      assert.equal(first.status, 201);
      const listing = (
        first.json as {
          listing: {
            id: number;
            title: string;
            maker: string | null;
            imageUrl: string | null;
            workId: number;
            workIdLocked: boolean;
          };
        }
      ).listing;
      assert.equal(listing.title, "テスト作品A");
      assert.equal(listing.maker, "サークルA");
      assert.ok(listing.imageUrl);

      // Manually enrich precision / lock like a prior import + human lock.
      db.prepare(
        `UPDATE listing SET purchased_at = ?, purchased_at_precision = 'day', work_id_locked = 1 WHERE id = ?`,
      ).run("2026-01-02", listing.id);

      // Re-run without product fetcher → cid-only fallback must not regress.
      const { server: s2, port: p2 } = await startTestServer(db, async () => null);
      try {
        const second = await request(p2, "POST", "/api/listings/manual", {
          url: "https://www.dlsite.com/maniax/work/=/product_id/RJ000001.html",
        });
        assert.equal(second.status, 200);
        const again = (
          second.json as {
            listing: {
              title: string;
              maker: string | null;
              imageUrl: string | null;
              workId: number;
              workIdLocked: boolean;
              purchasedAt: string | null;
            };
          }
        ).listing;
        assert.equal(again.title, "テスト作品A");
        assert.equal(again.maker, "サークルA");
        assert.equal(again.imageUrl, listing.imageUrl);
        assert.equal(again.workId, listing.workId);
        assert.equal(again.workIdLocked, true);
        assert.equal(again.purchasedAt, "2026-01-02");

        const row = db
          .prepare(
            `SELECT title, maker_name, image_url, purchased_at_precision, work_id_locked, work_id
             FROM listing WHERE cid = 'RJ000001'`,
          )
          .get() as {
          title: string;
          maker_name: string | null;
          image_url: string | null;
          purchased_at_precision: string;
          work_id_locked: number;
          work_id: number;
        };
        assert.equal(row.title, "テスト作品A");
        assert.equal(row.maker_name, "サークルA");
        assert.equal(row.image_url, listing.imageUrl);
        assert.equal(row.purchased_at_precision, "day");
        assert.equal(row.work_id_locked, 1);
        assert.equal(row.work_id, listing.workId);
      } finally {
        s2.close();
      }
    } finally {
      server.close();
      db.close();
    }
  });
});

describe("manual purchasedAt display precision", () => {
  it("suppresses a stored timestamp when its precision is unknown", async () => {
    const db = openDatabase(":memory:").sqlite;
    const { server, port } = await startTestServer(db, async () => null);
    try {
      const first = await request(port, "POST", "/api/listings/manual", {
        url: "https://www.dlsite.com/maniax/work/=/product_id/RJ000002.html",
      });
      assert.equal(first.status, 201);
      db.prepare(
        `UPDATE listing SET purchased_at = ?, purchased_at_precision = 'unknown'
         WHERE source = 'dlsite' AND cid = 'RJ000002'`,
      ).run("2026-01-03");

      const current = await request(port, "POST", "/api/listings/manual", {
        url: "https://www.dlsite.com/maniax/work/=/product_id/RJ000002.html",
      });
      assert.equal(current.status, 200);
      const listing = (current.json as {
        listing: { purchasedAt: string | null; purchasedAtPrecision: string };
      }).listing;
      assert.equal(listing.purchasedAt, null);
      assert.equal(listing.purchasedAtPrecision, "unknown");
    } finally {
      server.close();
      db.close();
    }
  });
});

describe("productFetcher trust boundary + atomic upsert", () => {
  it("sanitizeProductImageUrl rejects non-http(s) and malformed values", () => {
    assert.equal(sanitizeProductImageUrl("https://img.example/a.jpg"), "https://img.example/a.jpg");
    assert.equal(sanitizeProductImageUrl("http://img.example/a.jpg"), "http://img.example/a.jpg");
    assert.equal(sanitizeProductImageUrl("not a url"), null);
    assert.equal(sanitizeProductImageUrl("ftp://img.example/a.jpg"), null);
    assert.equal(sanitizeProductImageUrl("javascript:alert(1)"), null);
    assert.equal(sanitizeProductImageUrl(""), null);
    assert.equal(sanitizeProductImageUrl(null), null);
    assert.equal(sanitizeProductImageUrl(123), null);
  });

  it("invalid product image URL nulls image without 500 or partial commit regression", async () => {
    const db = openDatabase(":memory:").sqlite;
    const badProduct = [
      {
        workno: "RJ000777",
        work_name: "Bad Image Work",
        maker_name: "MakerX",
        series_id: null,
        image_url: "not-a-valid-url",
      },
    ];
    const { server, port } = await startTestServer(db, async (workno) => {
      if (workno === "RJ000777") return badProduct;
      return null;
    });
    try {
      const beforeCount = (
        db.prepare("SELECT COUNT(*) AS c FROM listing").get() as { c: number }
      ).c;
      const res = await request(port, "POST", "/api/listings/manual", {
        url: "https://www.dlsite.com/maniax/work/=/product_id/RJ000777.html",
      });
      assert.equal(res.status, 201);
      const listing = (
        res.json as {
          listing: { title: string; maker: string | null; imageUrl: string | null };
        }
      ).listing;
      assert.equal(listing.title, "Bad Image Work");
      assert.equal(listing.maker, "MakerX");
      assert.equal(listing.imageUrl, null);

      const afterCount = (
        db.prepare("SELECT COUNT(*) AS c FROM listing").get() as { c: number }
      ).c;
      assert.equal(afterCount, beforeCount + 1);
      const row = db
        .prepare("SELECT image_url, title FROM listing WHERE cid = 'RJ000777'")
        .get() as { image_url: string | null; title: string };
      assert.equal(row.image_url, null);
      assert.equal(row.title, "Bad Image Work");
    } finally {
      server.close();
      db.close();
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

describe("actual production startServer wiring (stubbed fetch, no live network)", () => {
  it("startServer ApiContext includes productFetcher and enriches manual listings", async () => {
    const dir = mkdtempSync(join(tmpdir(), "adp-start-"));
    const dbPath = join(dir, "data.sqlite");
    const productJson = JSON.parse(
      readFileSync(join(FIXTURES, "dlsite-product-rj000001.json"), "utf8"),
    );
    let fetchCalls = 0;
    const fetchImpl = (async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify(productJson), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const started = startServer({
      env: {
        ADP_DB_PATH: dbPath,
        ADP_EXTENSION_ORIGIN: TEST_EXTENSION_ORIGIN,
        // no ADP_PORT → default / persisted path
      },
      fetchImpl,
      host: "127.0.0.1",
      port: 0,
      listen: true,
    });
    try {
      await started.ready;
      assert.equal(started.hasProductFetcher, true);
      assert.ok(started.port > 0);
      const res = await request(started.port, "POST", "/api/listings/manual", {
        url: "https://www.dlsite.com/maniax/work/=/product_id/RJ000001.html",
      });
      assert.equal(res.status, 201);
      assert.equal(fetchCalls, 1);
      const listing = (res.json as { listing: { title: string; cid: string } }).listing;
      assert.equal(listing.cid, "RJ000001");
      assert.equal(listing.title, "テスト作品A");
    } finally {
      started.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies persisted port after DB open (restart-equivalent, env ADP_PORT unset)", () => {
    const dir = mkdtempSync(join(tmpdir(), "adp-port-"));
    const dbPath = join(dir, "data.sqlite");
    try {
      const appDb = openDatabase(dbPath);
      persistAdminSettings(
        appDb.sqlite,
        { port: 43210, exportDestination: "/tmp/adp-export-folder" },
        new Date().toISOString(),
      );
      appDb.close();

      const env: Record<string, string | undefined> = {
        ADP_DB_PATH: dbPath,
        // ADP_PORT intentionally unset
      };
      const config = loadConfig(env);
      assert.equal(config.port, 41321);

      const reopened = openDatabase(dbPath);
      const resolved = resolveListenPort(config, reopened.sqlite, env);
      assert.equal(resolved, 43210);
      const settings = loadAdminSettings(reopened.sqlite, config.port);
      assert.equal(settings.port, 43210);
      assert.equal(settings.exportDestination, "/tmp/adp-export-folder");
      reopened.close();

      // Explicit ADP_PORT wins over persisted
      const envForced = { ...env, ADP_PORT: "45000" };
      const configForced = loadConfig(envForced);
      const reopened2 = openDatabase(dbPath);
      assert.equal(resolveListenPort(configForced, reopened2.sqlite, envForced), 45000);
      reopened2.close();

      // forced option wins over both
      const reopened3 = openDatabase(dbPath);
      assert.equal(resolveListenPort(configForced, reopened3.sqlite, envForced, 0), 0);
      reopened3.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
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
