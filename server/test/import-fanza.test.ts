import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { createServer, type Server } from "node:http";
import { openDatabase } from "../src/db.js";
import { handleApi } from "../src/http.js";
import type { DatabaseSync } from "node:sqlite";
import { importListingBatch } from "../src/import/fanza/common.js";

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

  it("parses Books library pagination at the server import boundary", async () => {
    const res = await request(port, "POST", "/api/import/fanza_books", {
      series_books: [{
        series_id: "synthetic-series",
        author: "synthetic-author",
        unknownSeriesField: { nested: true },
      }],
      pager: { page: 1, per_page: 1, total_count: 2 },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, {
      inserted: 0,
      updated: 0,
      series: [{
        seriesId: "synthetic-series",
        author: "synthetic-author",
        seriesRaw: {
          series_id: "synthetic-series",
          author: "synthetic-author",
          unknownSeriesField: { nested: true },
        },
      }],
      hasNext: true,
    });
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
    assert.equal((res.json as { itemCount: number }).itemCount, 1);
    assert.equal((res.json as { totalCount: number }).totalCount, 1);
  });

  it("imports each page in one transaction and defers match keys to rematch", async () => {
    const res = await request(port, "POST", "/api/import/fanza_doujin", {
      error_code: 0,
      data: {
        items: {
          "2026年01月02日": [{ contentId: "d_transactional", title: "transactional" }],
        },
      },
    });
    assert.equal(res.status, 200);
    const before = db
      .prepare(
        `SELECT COUNT(*) AS count FROM match_key
         WHERE listing_id = (SELECT id FROM listing WHERE source = 'fanza_doujin' AND cid = 'd_transactional')`,
      )
      .get() as { count: number };
    assert.equal(before.count, 0);

    const rematch = await request(port, "POST", "/api/rematch", {});
    assert.equal(rematch.status, 200);
    const after = db
      .prepare(
        `SELECT COUNT(*) AS count FROM match_key
         WHERE listing_id = (SELECT id FROM listing WHERE source = 'fanza_doujin' AND cid = 'd_transactional')`,
      )
      .get() as { count: number };
    assert.equal(after.count, 1);
  });

  it("rolls back a FANZA page when a row write fails", () => {
    assert.throws(() =>
      importListingBatch(db, "fanza_doujin", [{
        cid: "d_rollback",
        title: null as unknown as string,
        maker: null,
        seriesId: null,
        imageUrl: null,
        purchasedAt: null,
        purchasedAtPrecision: "day",
        rawJson: "{}",
      }]),
    );
    const row = db
      .prepare("SELECT id FROM listing WHERE source = 'fanza_doujin' AND cid = 'd_rollback'")
      .get();
    assert.equal(row, undefined);
  });

  it("upserts synthetic listings for every FANZA source through the common route", async () => {
    const cases: Array<[string, unknown]> = [
      [
        "fanza_doujin",
        {
          error_code: 0,
          data: {
            items: {
              "2026年01月01日": [{ contentId: "synthetic-doujin-upsert", title: "synthetic" }],
            },
          },
        },
      ],
      [
        "fanza_books",
        {
          seriesId: "synthetic-series-upsert",
          payload: {
            volume_books: [{
              content_id: "synthetic-book-upsert",
              title: "synthetic",
              purchased: { purchased_date: "2026-01-01T00:00:00Z" },
            }],
          },
        },
      ],
      [
        "fanza_video",
        {
          data: { user: { ppvLibrary: { contentViewingRightsSummaryList: {
            pageInfo: { hasNext: false },
            items: [{ content: { id: "synthetic-video-upsert", title: "synthetic" } }],
          } } } },
        },
      ],
      [
        "fanza_dlsoft",
        {
          error: null,
          body: {
            totalCount: 1,
            library: [{ contentId: "synthetic-dlsoft-upsert", title: "synthetic" }],
          },
        },
      ],
    ];

    for (const [source, payload] of cases) {
      const inserted = await request(port, "POST", `/api/import/${source}`, payload);
      const updated = await request(port, "POST", `/api/import/${source}`, payload);
      assert.equal(inserted.status, 200, source);
      assert.deepEqual(
        { inserted: (inserted.json as { inserted: number }).inserted, updated: (inserted.json as { updated: number }).updated },
        { inserted: 1, updated: 0 },
        source,
      );
      assert.deepEqual(
        { inserted: (updated.json as { inserted: number }).inserted, updated: (updated.json as { updated: number }).updated },
        { inserted: 0, updated: 1 },
        source,
      );
    }
  });

  it("rejects source error payloads without writing listings", async () => {
    const cases: Array<[string, unknown]> = [
      ["fanza_doujin", { error_code: 1, data: { items: {} } }],
      ["fanza_books", { error: "synthetic_error", series_books: [] }],
      ["fanza_video", { errors: [{ message: "synthetic_error" }] }],
      ["fanza_dlsoft", { error: "synthetic_error", body: { library: [] } }],
    ];
    for (const [source, payload] of cases) {
      const res = await request(port, "POST", `/api/import/${source}`, payload);
      assert.equal(res.status, 400, source);
    }
  });

  it("marks fanza source synced via POST sync-state", async () => {
    const res = await request(port, "POST", "/api/sync-state/fanza_doujin", {});
    assert.equal(res.status, 200);
    const state = await request(port, "GET", "/api/sync-state/fanza_doujin");
    assert.equal(state.status, 200);
    assert.ok((state.json as { lastSyncedAt: string }).lastSyncedAt);
  });

  it("persists the latest per-source outcome independently of last-synced time", async () => {
    const saved = await request(port, "POST", "/api/sync-outcome/fanza_doujin", {
      ok: false,
      counts: { inserted: 2, updated: 3 },
      error: "synthetic_failure",
      fetched: 4,
    });
    assert.equal(saved.status, 200);
    const state = await request(port, "GET", "/api/sync-state/fanza_doujin");
    assert.equal(state.status, 200);
    assert.deepEqual((state.json as { latestOutcome: unknown }).latestOutcome, {
      ok: false,
      counts: { inserted: 2, updated: 3 },
      error: "synthetic_failure",
      fetched: 4,
      recordedAt: (state.json as { latestOutcome: { recordedAt: string } }).latestOutcome.recordedAt,
    });
  });

  it("returns validated Doujin and Video pagination metadata from import", async () => {
    const doujin = await request(port, "POST", "/api/import/fanza_doujin", {
      error_code: 0,
      data: {
        items: {
          "2026年03月01日": [{ contentId: "synthetic-doujin-page", title: "synthetic" }],
        },
        hasNext: true,
      },
    });
    assert.equal(doujin.status, 200);
    assert.equal((doujin.json as { hasNext: boolean }).hasNext, true);

    const video = await request(port, "POST", "/api/import/fanza_video", {
      data: {
        user: {
          ppvLibrary: {
            contentViewingRightsSummaryList: {
              pageInfo: { hasNext: false, totalCount: 1 },
              items: [{ content: { id: "synthetic-video-page", title: "synthetic" } }],
            },
          },
        },
      },
    });
    assert.equal(video.status, 200);
    assert.equal((video.json as { hasNext: boolean }).hasNext, false);
  });

  it("GET sync-state does not create schema objects for outcomes", async () => {
    const before = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name = 'sync_outcome'`,
      )
      .get() as { name: string } | undefined;
    assert.equal(before, undefined);

    const state = await request(port, "GET", "/api/sync-state/fanza_video");
    assert.equal(state.status, 200);
    assert.equal((state.json as { latestOutcome: unknown }).latestOutcome, null);

    const after = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name = 'sync_outcome'`,
      )
      .get() as { name: string } | undefined;
    assert.equal(after, undefined);

    // Outcomes reuse migration-backed sync_state rows with a reserved source key.
    await request(port, "POST", "/api/sync-outcome/fanza_video", {
      ok: true,
      counts: { inserted: 1, updated: 0 },
      fetched: 1,
    });
    const stored = db
      .prepare("SELECT source, cursor FROM sync_state WHERE source = ?")
      .get("__sync_outcome__:fanza_video") as { source: string; cursor: string } | undefined;
    assert.ok(stored);
    assert.match(stored.cursor, /"ok":true/);
  });

  it("preserves existing enrichment and merges raw evidence across partial re-imports", async () => {
    const sources: Array<[string, unknown, unknown]> = [
      [
        "fanza_doujin",
        {
          error_code: 0,
          data: {
            items: {
              "2026年05月01日": [{
                contentId: "synthetic-partial-doujin",
                title: "synthetic full",
                makerName: "Maker Full",
                imageSrc: "https://example.test/doujin.png",
                nestedKeep: { a: 1 },
              }],
            },
          },
        },
        {
          error_code: 0,
          data: {
            items: {
              "2026年05月02日": [{
                contentId: "synthetic-partial-doujin",
                title: "synthetic partial",
              }],
            },
          },
        },
      ],
      [
        "fanza_books",
        {
          seriesId: "synthetic-partial-series",
          author: "Author Full",
          seriesRaw: {
            series_id: "synthetic-partial-series",
            author: "Author Full",
            unknownSeriesField: { nested: ["keep"] },
          },
          payload: {
            volume_books: [{
              content_id: "synthetic-partial-book",
              title: "synthetic full book",
              image_url_source: "https://example.test/book.png",
              purchased: { purchased_date: "2026-05-01T00:00:00Z" },
            }],
          },
        },
        {
          seriesId: "synthetic-partial-series",
          author: null,
          payload: {
            volume_books: [{
              content_id: "synthetic-partial-book",
              title: "synthetic partial book",
              purchased: { purchased_date: "2026-05-02T00:00:00Z" },
            }],
          },
        },
      ],
      [
        "fanza_video",
        {
          data: {
            user: {
              ppvLibrary: {
                contentViewingRightsSummaryList: {
                  pageInfo: { hasNext: false },
                  items: [{
                    content: {
                      id: "synthetic-partial-video",
                      title: "synthetic full video",
                      floor: "videoa",
                    },
                    contentItem: {
                      latestViewingRightsAcquiredAt: "2025-01-01T00:00:00Z",
                      keepMe: true,
                    },
                  }],
                },
              },
            },
          },
        },
        {
          data: {
            user: {
              ppvLibrary: {
                contentViewingRightsSummaryList: {
                  pageInfo: { hasNext: false },
                  items: [{
                    content: {
                      id: "synthetic-partial-video",
                      title: "synthetic partial video",
                    },
                  }],
                },
              },
            },
          },
        },
      ],
      [
        "fanza_dlsoft",
        {
          error: null,
          body: {
            totalCount: 1,
            library: [{
              contentId: "synthetic-partial-dlsoft",
              title: "synthetic full dlsoft",
              brand: { name: "Brand Full" },
              packageImageUrl: "https://example.test/dlsoft.png",
              keepField: { nested: "yes" },
            }],
          },
        },
        {
          error: null,
          body: {
            totalCount: 1,
            library: [{
              contentId: "synthetic-partial-dlsoft",
              title: "synthetic partial dlsoft",
            }],
          },
        },
      ],
    ];

    for (const [source, fullPayload, partialPayload] of sources) {
      const first = await request(port, "POST", `/api/import/${source}`, fullPayload);
      assert.equal(first.status, 200, source);
      const second = await request(port, "POST", `/api/import/${source}`, partialPayload);
      assert.equal(second.status, 200, source);

      const row = db
        .prepare(
          `SELECT title, maker_name, series_id, image_url, purchased_at, raw_json
           FROM listing WHERE source = ? AND cid LIKE 'synthetic-partial-%'`,
        )
        .get(source) as {
        title: string;
        maker_name: string | null;
        series_id: string | null;
        image_url: string | null;
        purchased_at: string | null;
        raw_json: string;
      };
      assert.match(row.title, /partial/, source);
      const raw = JSON.parse(row.raw_json) as Record<string, unknown>;

      if (source === "fanza_doujin") {
        assert.equal(row.maker_name, "Maker Full");
        assert.equal(row.image_url, "https://example.test/doujin.png");
        assert.equal(row.purchased_at, "2026-05-02");
        assert.deepEqual((raw.sale as Record<string, unknown>).nestedKeep, { a: 1 });
      }
      if (source === "fanza_books") {
        assert.equal(row.maker_name, "Author Full");
        assert.equal(row.series_id, "synthetic-partial-series");
        assert.equal(row.purchased_at, "2026-05-02T00:00:00Z");
        assert.deepEqual(
          ((raw.sale as Record<string, unknown>).series as Record<string, unknown>)
            .unknownSeriesField,
          { nested: ["keep"] },
        );
        assert.equal(
          (raw.sale as Record<string, unknown>).image_url_source,
          "https://example.test/book.png",
        );
      }
      if (source === "fanza_video") {
        assert.equal(
          (raw.sale as { contentItem?: { keepMe?: boolean; latestViewingRightsAcquiredAt?: string } })
            .contentItem?.keepMe,
          true,
        );
        assert.equal(
          (raw.sale as { contentItem?: { latestViewingRightsAcquiredAt?: string } })
            .contentItem?.latestViewingRightsAcquiredAt,
          "2025-01-01T00:00:00Z",
        );
        assert.equal(
          (raw.sale as { content?: { floor?: string } }).content?.floor,
          "videoa",
        );
      }
      if (source === "fanza_dlsoft") {
        assert.equal(row.maker_name, "Brand Full");
        assert.equal(row.image_url, "https://example.test/dlsoft.png");
        assert.deepEqual((raw.sale as Record<string, unknown>).keepField, { nested: "yes" });
      }
    }
  });
});
