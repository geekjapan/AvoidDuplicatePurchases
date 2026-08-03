import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { createServer, type Server } from "node:http";
import { openDatabase } from "../src/db.js";
import { handleApi } from "../src/http.js";
import type { DatabaseSync } from "node:sqlite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED_FIXTURES = join(__dirname, "../../shared/test/fixtures");
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

function startTestServer(db: DatabaseSync): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    let listenPort = 0;
    const server = createServer(async (req, res) => {
      await handleApi(req, res, {
        db,
        port: listenPort,
        extensionOrigins: TEST_EXTENSION_ORIGINS,
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

describe("fanza import API", () => {
  let server: Server;
  let port: number;
  let db: DatabaseSync;

  before(async () => {
    const appDb = openDatabase(":memory:");
    db = appDb.sqlite;
    const started = await startTestServer(db);
    server = started.server;
    port = started.port;
  });

  after(() => {
    server.close();
  });

  it("imports fanza_doujin with day precision", async () => {
    const raw = JSON.parse(readFileSync(join(SHARED_FIXTURES, "fanza-doujin-page.json"), "utf8"));
    const res = await request(port, "POST", "/api/import/fanza_doujin", raw);
    assert.equal(res.status, 200);
    const row = db
      .prepare(
        "SELECT purchased_at, purchased_at_precision FROM listing WHERE source = 'fanza_doujin' AND cid = 'd_100001'",
      )
      .get() as { purchased_at: string; purchased_at_precision: string };
    assert.equal(row.purchased_at, "2026-07-24");
    assert.equal(row.purchased_at_precision, "day");
  });

  it("imports fanza_books with second precision and series_id", async () => {
    const raw = JSON.parse(readFileSync(join(SHARED_FIXTURES, "fanza-books-import.json"), "utf8"));
    const res = await request(port, "POST", "/api/import/fanza_books", raw);
    assert.equal(res.status, 200);
    const row = db
      .prepare(
        "SELECT purchased_at, purchased_at_precision, series_id FROM listing WHERE source = 'fanza_books' AND cid = 'b100xxxxx01001'",
      )
      .get() as {
      purchased_at: string;
      purchased_at_precision: string;
      series_id: string;
    };
    assert.equal(row.purchased_at_precision, "second");
    assert.equal(row.series_id, "100001");
    assert.match(row.purchased_at, /2023-12-30/);
  });

  it("imports fanza_video with unknown purchased_at", async () => {
    const raw = JSON.parse(readFileSync(join(SHARED_FIXTURES, "fanza-video-page.json"), "utf8"));
    const res = await request(port, "POST", "/api/import/fanza_video", raw);
    assert.equal(res.status, 200);
    const row = db
      .prepare(
        "SELECT purchased_at, purchased_at_precision, raw_json FROM listing WHERE source = 'fanza_video' AND cid = 'abcd00123'",
      )
      .get() as { purchased_at: null; purchased_at_precision: string; raw_json: string };
    assert.equal(row.purchased_at, null);
    assert.equal(row.purchased_at_precision, "unknown");
    const evidence = JSON.parse(row.raw_json);
    assert.equal(evidence.sale.latestViewingRightsAcquiredAt, "2025-09-23T00:00:00Z");
  });

  it("imports fanza_dlsoft with unknown purchased_at", async () => {
    const raw = JSON.parse(readFileSync(join(SHARED_FIXTURES, "fanza-dlsoft-page.json"), "utf8"));
    const res = await request(port, "POST", "/api/import/fanza_dlsoft", raw);
    assert.equal(res.status, 200);
    const row = db
      .prepare(
        "SELECT purchased_at, purchased_at_precision FROM listing WHERE source = 'fanza_dlsoft' AND cid = 'brand_0001'",
      )
      .get() as { purchased_at: null; purchased_at_precision: string };
    assert.equal(row.purchased_at, null);
    assert.equal(row.purchased_at_precision, "unknown");
  });

  it("marks fanza source synced via POST sync-state", async () => {
    const res = await request(port, "POST", "/api/sync-state/fanza_doujin", {});
    assert.equal(res.status, 200);
    const state = await request(port, "GET", "/api/sync-state/fanza_doujin");
    assert.equal(state.status, 200);
    assert.ok((state.json as { lastSyncedAt: string }).lastSyncedAt);
  });
});
