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
