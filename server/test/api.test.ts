import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { openDatabase } from "../src/db.js";
import { handleApi } from "../src/http.js";
import { seedDlsiteFromSales } from "../src/services/import.js";
import type { DatabaseSync } from "node:sqlite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");
const TEST_EXTENSION_ORIGIN = "chrome-extension://test-extension";
const TEST_EXTENSION_ORIGINS = new Set([TEST_EXTENSION_ORIGIN]);

function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  productFetcher?: (workno: string) => Promise<unknown | null>,
): Promise<{ status: number; json: unknown; text: string }> {
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
            ...(payload
              ? {
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(payload),
                }
              : {}),
            ...headers,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let json: unknown = null;
            try {
              json = text.length ? JSON.parse(text) : null;
            } catch {
              json = null;
            }
            resolve({ status: res.statusCode ?? 0, json, text });
          });
        },
      );
      r.on("error", reject);
      if (payload) r.write(payload);
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
        productFetcher,
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

describe("server API", () => {
  let server: Server;
  let port: number;
  let db: DatabaseSync;
  let dbPath: string;
  const productFixture = JSON.parse(
    readFileSync(join(FIXTURES, "dlsite-product-rj000001.json"), "utf8"),
  );
  const productFetcher = async (workno: string) => {
    if (workno.toUpperCase() === "RJ000001") return productFixture;
    return null;
  };

  before(async () => {
    dbPath = join(__dirname, `test-db-${Date.now()}.sqlite`);
    const appDb = openDatabase(dbPath);
    db = appDb.sqlite;
    const started = await startTestServer(db, productFetcher);
    server = started.server;
    port = started.port;
  });

  after(async () => {
    server.close();
    db.close();
  });

  it("applies migrations and owns SQLite ownership model", () => {
    const version = db.prepare("PRAGMA user_version").get() as { user_version: number };
    assert.equal(version.user_version, 1);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    assert.ok(names.includes("work"));
    assert.ok(names.includes("listing"));
    assert.ok(names.includes("match_key"));
  });

  it("imports DLsite fixture by upsert without deleting prior ownership", async () => {
    const sales = JSON.parse(readFileSync(join(FIXTURES, "dlsite-sales.json"), "utf8"));

    const first = await request(
      port,
      "POST",
      "/api/import/dlsite",
      sales,
      { Origin: TEST_EXTENSION_ORIGIN },
      productFetcher,
    );
    assert.equal(first.status, 200);
    assert.deepEqual(first.json, { inserted: 2, updated: 0 });

    const countBefore = (
      db.prepare("SELECT COUNT(*) AS c FROM listing").get() as { c: number }
    ).c;

    const second = await request(
      port,
      "POST",
      "/api/import/dlsite",
      sales,
      { Origin: TEST_EXTENSION_ORIGIN },
      productFetcher,
    );
    assert.equal(second.status, 200);
    assert.deepEqual(second.json, { inserted: 0, updated: 2 });

    const countAfter = (
      db.prepare("SELECT COUNT(*) AS c FROM listing").get() as { c: number }
    ).c;
    assert.equal(countAfter, countBefore);

    seedDlsiteFromSales(db, sales.slice(0, 1), { RJ000001: productFixture });
    const countStill = (
      db.prepare("SELECT COUNT(*) AS c FROM listing").get() as { c: number }
    ).c;
    assert.equal(countStill, countAfter);
  });

  it("lookup reports ownership for imported source and identifier", async () => {
    const res = await request(
      port,
      "POST",
      "/api/lookup",
      { items: [{ source: "dlsite", cid: "RJ000001" }] },
      { Origin: TEST_EXTENSION_ORIGIN },
    );
    assert.equal(res.status, 200);
    const body = res.json as { results: Array<{ owned: boolean }> };
    assert.equal(body.results[0]?.owned, true);

    const missing = await request(
      port,
      "POST",
      "/api/lookup",
      { items: [{ source: "dlsite", cid: "RJ999999" }] },
      { Origin: TEST_EXTENSION_ORIGIN },
    );
    assert.equal((missing.json as { results: Array<{ owned: boolean }> }).results[0]?.owned, false);
  });

  it("rejects invalid lookup payloads at API boundary", async () => {
    const res = await request(
      port,
      "POST",
      "/api/lookup",
      { items: [{}] },
      { Origin: TEST_EXTENSION_ORIGIN },
    );
    assert.equal(res.status, 400);
    assert.match(res.text, /invalid_request/);
    assert.doesNotMatch(res.text, /\/Users\/|stack|ENOENT/i);
  });

  it("returns sync-state for dlsite", async () => {
    const res = await request(
      port,
      "GET",
      "/api/sync-state/dlsite",
      undefined,
      { Origin: TEST_EXTENSION_ORIGIN },
    );
    assert.equal(res.status, 200);
    const body = res.json as { cursor: string | null; lastSyncedAt: string | null };
    assert.ok(body.lastSyncedAt);
  });

  it("runs rematch", async () => {
    const res = await request(
      port,
      "POST",
      "/api/rematch",
      {},
      { Origin: TEST_EXTENSION_ORIGIN },
    );
    assert.equal(res.status, 200);
    const body = res.json as { rematched: number; candidates: number };
    assert.ok(body.rematched >= 0);
    assert.ok(body.candidates >= 0);
  });
});
