import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { runAllFanzaSyncs } from "./sync.ts";
import { renderSyncStatus } from "../../popup/sync-status.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fanza four-source sync", () => {
  it("declares only the approved Video and Dlsoft history hosts", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../../../manifest.json", import.meta.url), "utf8"),
    ) as { host_permissions: string[] };
    const newHistoryHosts = manifest.host_permissions.filter(
      (host) => host.includes("api.video.dmm.co.jp") || host.includes("dlsoft.dmm.co.jp"),
    );
    assert.deepEqual(newHistoryHosts, [
      "https://api.video.dmm.co.jp/*",
      "https://dlsoft.dmm.co.jp/*",
    ]);
  });

  it("keeps raw-response parsing and pagination behind the server import boundary", () => {
    const source = readFileSync(new URL("./sync.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /parseBooksLibraryPayload/);
    assert.doesNotMatch(source, /parseDlsoftLibraryPayload/);
    assert.doesNotMatch(source, /parseDoujinMylibrariesPayload/);
    assert.doesNotMatch(source, /parseVideoGraphqlPayload/);
    assert.doesNotMatch(source, /doujinPageHasNext/);
    assert.doesNotMatch(source, /videoPageHasNext/);
    assert.doesNotMatch(source, /dlsoftPageHasNext/);
    assert.doesNotMatch(source, /dlsoftPageInfo/);
  });

  it("fetches, imports, and paginates all four sources sequentially", async () => {
    const previousFetch = globalThis.fetch;
    const storeSources: string[] = [];
    const importSources: string[] = [];
    const pageBySource = new Map<string, number>();

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith("http://127.0.0.1:41321/api/import/")) {
        const source = url.split("/").at(-1)!;
        importSources.push(source);
        const body = JSON.parse(String(init?.body));
        if (source === "fanza_books" && "series_books" in body) {
          const page = body.pager.page as number;
          return json({
            inserted: 0,
            updated: 0,
            series: [{
              seriesId: `synthetic-series-${page}`,
              author: null,
              seriesRaw: {
                series_id: `synthetic-series-${page}`,
                unknownSeriesField: { nested: true },
              },
            }],
            hasNext: page === 1,
          });
        }
        if (source === "fanza_doujin" || source === "fanza_video") {
          const page = (pageBySource.get(`${source}:import`) ?? 0) + 1;
          pageBySource.set(`${source}:import`, page);
          return json({ inserted: 1, updated: 0, hasNext: page === 1 });
        }
        if (source === "fanza_dlsoft") {
          return json({ inserted: 1, updated: 0, itemCount: 1, totalCount: 2 });
        }
        // Books contents import
        return json({ inserted: 1, updated: 0, hasNext: false });
      }
      if (url.startsWith("http://127.0.0.1:41321/api/sync-state/")) {
        return json({ cursor: null, lastSyncedAt: "2026-01-01T00:00:00.000Z" });
      }

      const source = url.includes("/dc/doujin/")
        ? "fanza_doujin"
        : url.includes("book.dmm.co.jp")
          ? "fanza_books"
          : url.includes("api.video.dmm.co.jp")
            ? "fanza_video"
            : "fanza_dlsoft";
      storeSources.push(source);
      const page = (pageBySource.get(source) ?? 0) + 1;
      pageBySource.set(source, page);

      if (source === "fanza_doujin") {
        return json({
          error_code: 0,
          data: {
            items: {
              "2026年01月01日": [{ contentId: `synthetic-doujin-${page}`, title: "synthetic" }],
            },
            hasNext: page === 1,
          },
        });
      }
      if (source === "fanza_books" && url.includes("/library/")) {
        return json({
          series_books: [{ series_id: `synthetic-series-${page}` }],
          pager: { page, per_page: 1, total_count: 2 },
        });
      }
      if (source === "fanza_books") {
        return json({
          volume_books: [
            {
              content_id: `synthetic-book-${page}`,
              title: "synthetic",
              purchased: { purchased_date: "2026-01-01T00:00:00Z" },
            },
          ],
          pager: { page: 1, per_page: 100, total_count: 1 },
        });
      }
      if (source === "fanza_video") {
        return json({
          data: {
            user: {
              ppvLibrary: {
                contentViewingRightsSummaryList: {
                  pageInfo: { hasNext: page === 1, totalCount: 2 },
                  items: [{ content: { id: `synthetic-video-${page}`, title: "synthetic" } }],
                },
              },
            },
          },
        });
      }
      return json({
        error: null,
        body: {
          totalCount: 2,
          library: [{ contentId: `synthetic-dlsoft-${page}`, title: "synthetic" }],
        },
      });
    };

    try {
      const outcomes = await runAllFanzaSyncs();
      assert.ok(Object.values(outcomes).every((outcome) => outcome.ok));
      assert.deepEqual(storeSources, [
        "fanza_doujin",
        "fanza_doujin",
        "fanza_books",
        "fanza_books",
        "fanza_books",
        "fanza_books",
        "fanza_video",
        "fanza_video",
        "fanza_dlsoft",
        "fanza_dlsoft",
      ]);
      assert.deepEqual(importSources, [
        "fanza_doujin",
        "fanza_doujin",
        "fanza_books",
        "fanza_books",
        "fanza_books",
        "fanza_books",
        "fanza_video",
        "fanza_video",
        "fanza_dlsoft",
        "fanza_dlsoft",
      ]);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("retains a failed source outcome and continues later independent sources", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/dc/doujin/")) return json({}, 503);
      if (url.startsWith("http://127.0.0.1:41321/api/import/fanza_books")) {
        const body = JSON.parse(String(init?.body));
        if ("series_books" in body) {
          return json({ inserted: 0, updated: 0, series: [], hasNext: false });
        }
      }
      if (url.startsWith("http://127.0.0.1:41321/api/import/")) {
        return json({ inserted: 0, updated: 0, itemCount: 0, totalCount: 0 });
      }
      if (url.startsWith("http://127.0.0.1:41321/api/sync-state/")) {
        return json({ cursor: null, lastSyncedAt: "2026-01-01T00:00:00.000Z" });
      }
      if (url.includes("book.dmm.co.jp")) {
        return json({ series_books: [], pager: { page: 1, per_page: 1, total_count: 0 } });
      }
      if (url.includes("api.video.dmm.co.jp")) {
        return json({
          data: { user: { ppvLibrary: { contentViewingRightsSummaryList: {
            pageInfo: { hasNext: false, totalCount: 0 }, items: [],
          } } } },
        });
      }
      return json({ error: null, body: { totalCount: 0, library: [] } });
    };
    try {
      const outcomes = await runAllFanzaSyncs();
      assert.equal(outcomes.fanza_doujin?.ok, false);
      assert.equal(outcomes.fanza_video?.ok, true);
      assert.equal(outcomes.fanza_dlsoft?.ok, true);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("renders retained per-source outcomes in the popup", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      json({ cursor: null, lastSyncedAt: "2026-01-01T00:00:00.000Z" });
    const container = { textContent: "" } as HTMLElement;
    try {
      await renderSyncStatus(container, {
        dlsite: { ok: true, counts: { inserted: 1, updated: 0 }, fetched: 1 },
        fanza_doujin: { ok: false, error: "synthetic_failure" },
        fanza_books: { ok: true, counts: { inserted: 1, updated: 0 }, fetched: 2 },
        fanza_video: { ok: true, counts: { inserted: 1, updated: 0 }, fetched: 1 },
        fanza_dlsoft: { ok: true, counts: { inserted: 1, updated: 0 }, fetched: 1 },
      });
      assert.match(container.textContent, /DLsite:/);
      assert.match(container.textContent, /FANZA 同人: エラー synthetic_failure/);
      assert.match(container.textContent, /FANZA ブックス:/);
      assert.match(container.textContent, /FANZA 動画:/);
      assert.match(container.textContent, /FANZA PCゲーム:/);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("renders persisted per-source outcomes on popup startup", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      json({
        cursor: null,
        lastSyncedAt: null,
        latestOutcome: {
          ok: false,
          counts: { inserted: 2, updated: 1 },
          error: "synthetic_failure",
          fetched: 3,
          recordedAt: "2026-01-01T00:00:00.000Z",
        },
      });
    const container = { textContent: "" } as HTMLElement;
    try {
      await renderSyncStatus(container);
      assert.match(container.textContent, /FANZA 同人: エラー synthetic_failure/);
      assert.match(container.textContent, /新規 2 \/ 更新 1/);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("passes failed full-sync source outcomes to popup rendering", () => {
    const popupSource = readFileSync(
      new URL("../../popup/popup.ts", import.meta.url),
      "utf8",
    );
    assert.match(popupSource, /if \(outcome\?\.sources\) \{/);
    assert.doesNotMatch(popupSource, /outcome\?\.ok && outcome\.sources/);
  });

  it("treats Dlsoft empty page with positive remaining total as source error", async () => {
    const previousFetch = globalThis.fetch;
    let markedSynced = false;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.startsWith("http://127.0.0.1:41321/api/import/fanza_dlsoft")) {
        return json({ inserted: 0, updated: 0, itemCount: 0, totalCount: 5 });
      }
      if (url.startsWith("http://127.0.0.1:41321/api/import/")) {
        return json({ inserted: 0, updated: 0, series: [], hasNext: false, itemCount: 0, totalCount: 0 });
      }
      if (url.startsWith("http://127.0.0.1:41321/api/sync-state/fanza_dlsoft")) {
        markedSynced = true;
        return json({ cursor: null, lastSyncedAt: "2026-01-01T00:00:00.000Z" });
      }
      if (url.startsWith("http://127.0.0.1:41321/api/sync-state/")) {
        return json({ cursor: null, lastSyncedAt: "2026-01-01T00:00:00.000Z" });
      }
      if (url.includes("/dc/doujin/")) {
        return json({ error_code: 0, data: { items: {}, hasNext: false } });
      }
      if (url.includes("book.dmm.co.jp")) {
        return json({ series_books: [], pager: { page: 1, per_page: 1, total_count: 0 } });
      }
      if (url.includes("api.video.dmm.co.jp")) {
        return json({
          data: { user: { ppvLibrary: { contentViewingRightsSummaryList: {
            pageInfo: { hasNext: false, totalCount: 0 }, items: [],
          } } } },
        });
      }
      return json({ error: null, body: { totalCount: 5, library: [] } });
    };
    try {
      const outcomes = await runAllFanzaSyncs();
      assert.equal(outcomes.fanza_dlsoft?.ok, false);
      assert.equal(outcomes.fanza_dlsoft?.error, "empty_page_positive_total");
      assert.equal(markedSynced, false);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
