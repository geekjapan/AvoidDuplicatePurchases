import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { openDatabase } from "../src/db.js";
import { handleApi } from "../src/http.js";
import { upsertFanzaListing } from "../src/import/fanza/common.js";
import { importLibraryBatch } from "../src/import/library/index.js";
import type { DatabaseSync } from "node:sqlite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_EXTENSION_ORIGIN = "chrome-extension://test-extension";
const TEST_EXTENSION_ORIGINS = new Set([TEST_EXTENSION_ORIGIN]);

const AMAZON_PAGE = "https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll/";

function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    import("node:http").then(({ request: httpRequest }) => {
      const r = httpRequest(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method,
          headers: {
            ...(payload !== undefined
              ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
              : {}),
            Origin: TEST_EXTENSION_ORIGIN,
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
            resolve({ status: res.statusCode ?? 0, json });
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

describe("DOM library-sync import", () => {
  let server: Server;
  let port: number;
  let db: DatabaseSync;

  before(async () => {
    const appDb = openDatabase(join(__dirname, `library-test-${Date.now()}.sqlite`));
    db = appDb.sqlite;
    const started = await startTestServer(db);
    server = started.server;
    port = started.port;
  });

  after(() => {
    server.close();
    db.close();
  });

  it("migrates listing to accept the three new sources and adds library_observation", () => {
    const version = db.prepare("PRAGMA user_version").get() as { user_version: number };
    assert.equal(version.user_version, 4);
    const check = (
      db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='listing'")
        .get() as { sql: string }
    ).sql;
    for (const source of ["amazon", "ebookjapan", "kobo"]) {
      assert.ok(check.includes(source), `listing CHECK must include ${source}`);
    }
    const obs = (
      db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='library_observation'")
        .get() as { sql: string }
    ).sql;
    assert.ok(obs.includes("PRIMARY KEY (source, cid)"));
  });

  it("keeps idempotent listing upsert semantics for the new sources", () => {
    const now = new Date().toISOString();
    for (const source of ["amazon", "ebookjapan", "kobo"] as const) {
      const listing = {
        cid: `CID-${source}`,
        title: `合成 ${source}`,
        maker: null,
        seriesId: null,
        imageUrl: null,
        purchasedAt: null,
        purchasedAtPrecision: "unknown" as const,
        rawJson: "{}",
      };
      assert.equal(upsertFanzaListing(db, source, listing, now), "inserted");
      assert.equal(upsertFanzaListing(db, source, listing, now), "updated");
    }
    const count = (
      db.prepare("SELECT COUNT(*) AS c FROM listing").get() as { c: number }
    ).c;
    assert.equal(count, 3);
  });

  it("imports a bounded batch idempotently and preserves explicit states", async () => {
    const batch = {
      source: "amazon",
      pageUrl: AMAZON_PAGE,
      items: [
        { cid: "SYNTHETI01", title: "購入済み", state: "purchased" },
        { cid: "SYNTHETI02", title: "レンタル", state: "rental" },
        { cid: "SYNTHETI03", title: "不明", state: "unknown" },
        { cid: "SYNTHETI04", title: "無料", state: "free" },
      ],
    };
    const first = await request(port, "POST", "/api/import/library", batch);
    assert.equal(first.status, 200);
    assert.deepEqual(first.json, {
      observed: 4,
      inserted: 4,
      updated: 0,
      byState: {
        purchased: 1,
        free: 1,
        rental: 1,
        sample: 0,
        preview: 0,
        subscription: 0,
        gift: 0,
        reservation: 0,
        unknown: 1,
      },
    });

    // Idempotent re-import of the same visible batch.
    const second = await request(port, "POST", "/api/import/library", batch);
    assert.deepEqual(second.json, {
      observed: 4,
      inserted: 0,
      updated: 4,
      byState: {
        purchased: 1,
        free: 1,
        rental: 1,
        sample: 0,
        preview: 0,
        subscription: 0,
        gift: 0,
        reservation: 0,
        unknown: 1,
      },
    });

    // States are preserved verbatim; only explicit purchased evidence creates
    // the ownership listing. Non-purchased states remain observations only.
    const rows = db
      .prepare(
        "SELECT cid, state, title, page_url FROM library_observation ORDER BY cid",
      )
      .all() as Array<{ cid: string; state: string; title: string; page_url: string }>;
    assert.deepEqual(
      rows.map((r) => [r.cid, r.state]),
      [
        ["SYNTHETI01", "purchased"],
        ["SYNTHETI02", "rental"],
        ["SYNTHETI03", "unknown"],
        ["SYNTHETI04", "free"],
      ],
    );
    assert.ok(rows.every((r) => r.page_url === AMAZON_PAGE));
    const listingCount = (
      db.prepare("SELECT COUNT(*) AS c FROM listing").get() as { c: number }
    ).c;
    assert.equal(listingCount, 4, "only the purchased observation creates an owned listing");
    const owned = db
      .prepare("SELECT source, cid, title FROM listing WHERE source = 'amazon'")
      .all() as Array<{ source: string; cid: string; title: string }>;
    assert.deepEqual(owned.map((row) => ({ ...row })), [
      { source: "amazon", cid: "CID-amazon", title: "合成 amazon" },
      { source: "amazon", cid: "SYNTHETI01", title: "購入済み" },
    ]);
  });

  it("accepts only canonical source pages and matching visible product URLs", async () => {
    const valid = [
      {
        source: "amazon",
        pageUrl: AMAZON_PAGE,
        item: {
          cid: "A123456789",
          title: "Amazon synthetic",
          state: "purchased",
          productUrl: "https://www.amazon.co.jp/dp/A123456789",
        },
      },
      {
        source: "ebookjapan",
        pageUrl: "https://ebookjapan.yahoo.co.jp/bookshelf/",
        item: {
          cid: "A123456789",
          title: "ebookjapan synthetic",
          state: "purchased",
          productUrl: "https://ebookjapan.yahoo.co.jp/books/123/A123456789/",
        },
      },
      {
        source: "kobo",
        pageUrl: "https://books.rakuten.co.jp/e-book/kobo/library/",
        item: {
          cid: "kobo-opaque_1",
          title: "Kobo synthetic",
          state: "purchased",
          productUrl: "https://books.rakuten.co.jp/rk/kobo-opaque_1",
        },
      },
    ] as const;
    for (const batch of valid) {
      assert.equal(
        (await request(port, "POST", "/api/import/library", {
          source: batch.source,
          pageUrl: batch.pageUrl,
          items: [batch.item],
        })).status,
        200,
      );
    }

    const invalid = [
      { ...valid[0]!, pageUrl: `${AMAZON_PAGE}unrelated` },
      { ...valid[0]!, pageUrl: "https://evil.example/library" },
      { ...valid[0]!, item: { ...valid[0]!.item, cid: "bad" } },
      {
        ...valid[0]!,
        item: { ...valid[0]!.item, productUrl: "https://evil.example/dp/A123456789" },
      },
      {
        ...valid[0]!,
        item: { ...valid[0]!.item, productUrl: "https://www.amazon.co.jp/dp/A999999999" },
      },
      {
        ...valid[2]!,
        item: {
          ...valid[2]!.item,
          productUrl: "https://books.rakuten.co.jp/e-book/download/code",
        },
      },
    ];
    for (const batch of invalid) {
      assert.equal(
        (await request(port, "POST", "/api/import/library", {
          source: batch.source,
          pageUrl: batch.pageUrl,
          items: [batch.item],
        })).status,
        400,
      );
    }
  });

  it("rejects invalid batches at the API boundary", async () => {
    const base = {
      source: "kobo",
      pageUrl: "https://books.rakuten.co.jp/e-book/kobo/library/",
    };
    const items = [{ cid: "K1", title: "t", state: "purchased" }];

    // Non-library source and unknown state.
    assert.equal(
      (await request(port, "POST", "/api/import/library", { ...base, source: "dlsite", items })).status,
      400,
    );
    assert.equal(
      (await request(port, "POST", "/api/import/library", { ...base, items: [{ ...items[0], state: "owned" }] })).status,
      400,
    );

    // Price fields stay out of the contract.
    assert.equal(
      (
        await request(port, "POST", "/api/import/library", {
          ...base,
          items: [{ ...items[0], currentPrice: { amountMinor: 1, currency: "JPY", taxStatus: "included" } }],
        })
      ).status,
      400,
    );

    // pageUrl must be https and belong to the registered provider host.
    assert.equal(
      (await request(port, "POST", "/api/import/library", { ...base, pageUrl: "http://books.rakuten.co.jp/", items })).status,
      400,
    );
    assert.equal(
      (await request(port, "POST", "/api/import/library", { ...base, pageUrl: "https://127.0.0.1/private", items })).status,
      400,
    );
    assert.equal(
      (await request(port, "POST", "/api/import/library", { ...base, pageUrl: "https://www.amazon.co.jp/x", items })).status,
      400,
    );

    // Bounded batch: empty and oversized bodies are rejected.
    assert.equal(
      (await request(port, "POST", "/api/import/library", { ...base, items: [] })).status,
      400,
    );
    assert.equal(
      (
        await request(port, "POST", "/api/import/library", {
          ...base,
          items: Array.from({ length: 101 }, (_, i) => ({ cid: `K${i}`, title: "t", state: "unknown" })),
        })
      ).status,
      400,
    );
  });

  it("reports persistence failures as 500 after the request has passed validation", async () => {
    const failedDb = openDatabase(":memory:").sqlite;
    const started = await startTestServer(failedDb);
    failedDb.close();
    try {
      const response = await request(started.port, "POST", "/api/import/library", {
        source: "kobo",
        pageUrl: "https://books.rakuten.co.jp/e-book/kobo/library/",
        items: [{ cid: "KFAIL01", title: "t", state: "unknown" }],
      });
      assert.deepEqual(response, { status: 500, json: { error: "import_failed" } });
    } finally {
      started.server.close();
    }
  });

  it("uses a savepoint when the caller already owns a transaction", () => {
    const nestedDb = openDatabase(":memory:").sqlite;
    try {
      nestedDb.exec("BEGIN");
      const counts = importLibraryBatch(
        nestedDb,
        "kobo",
        "https://books.rakuten.co.jp/e-book/kobo/library/",
        [{ cid: "KNEST01", title: "t", state: "unknown" }],
      );
      assert.equal(counts.observed, 1);
      nestedDb.exec("ROLLBACK");
      assert.equal(
        (nestedDb.prepare("SELECT COUNT(*) AS count FROM library_observation").get() as { count: number })
          .count,
        0,
      );
    } finally {
      nestedDb.close();
    }
  });

  it("reads and marks sync state for the three library sources", async () => {
    for (const source of ["amazon", "ebookjapan", "kobo"]) {
      const read = await request(port, "GET", `/api/sync-state/${source}`);
      assert.equal(read.status, 200);
      assert.deepEqual(read.json, { cursor: null, lastSyncedAt: null, latestOutcome: null });
      const mark = await request(port, "POST", `/api/sync-state/${source}`, {});
      assert.equal(mark.status, 200);
      const after = (mark.json as { lastSyncedAt: string | null }).lastSyncedAt;
      assert.equal(typeof after, "string");
      // Legacy sources keep their own sync-state handling.
      assert.equal((await request(port, "GET", "/api/sync-state/dlsite")).status, 200);
    }
  });
});
