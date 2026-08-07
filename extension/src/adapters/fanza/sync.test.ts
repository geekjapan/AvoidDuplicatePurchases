import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  runAllFanzaSyncs,
  runFanzaBooksSync,
  runFanzaVideoSync,
} from "./sync.ts";
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
    ) as { host_permissions: string[]; permissions: string[] };
    assert.ok(manifest.permissions.includes("scripting"));
    const newHistoryHosts = manifest.host_permissions.filter(
      (host) =>
        host.includes("video.dmm.co.jp") ||
        host.includes("api.video.dmm.co.jp") ||
        host.includes("dlsoft.dmm.co.jp"),
    );
    assert.deepEqual(newHistoryHosts, [
      "https://video.dmm.co.jp/*",
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

  it("accepts authenticated Video requests from the video page origin", async () => {
    const previousFetch = globalThis.fetch;
    const globalWithChrome = globalThis as typeof globalThis & { chrome?: unknown };
    const previousChrome = globalWithChrome.chrome;
    let pageRequest: { input: string; init?: RequestInit } | undefined;
    let pageReady = false;
    let removedTab = false;

    globalWithChrome.chrome = {
      tabs: {
        query: async () => [],
        create: async () => ({
          id: 17,
          url: "https://video.dmm.co.jp/av/mylibrary/",
          status: "loading",
        }),
        get: async () => ({
          id: 17,
          status: pageReady ? "complete" : "loading",
        }),
        remove: async (tabId: number) => {
          assert.equal(tabId, 17);
          removedTab = true;
        },
        onUpdated: {
          addListener: (listener: (tabId: number, changeInfo: { status?: string }) => void) => {
            queueMicrotask(() => {
              pageReady = true;
              listener(17, { status: "complete" });
            });
          },
          removeListener: () => {},
        },
      },
      scripting: {
        executeScript: async (details: {
          target: { tabId: number };
          world: string;
          func: (...args: unknown[]) => Promise<unknown>;
          args?: unknown[];
        }) => {
          assert.equal(details.target.tabId, 17);
          assert.equal(details.world, "MAIN");
          assert.equal(pageReady, true);

          const pageFetch = globalThis.fetch;
          globalThis.fetch = async (input, init) => {
            pageRequest = { input: String(input), init };
            return json({
              data: {
                user: {
                  ppvLibrary: {
                    contentViewingRightsSummaryList: {
                      pageInfo: { hasNext: false, totalCount: 1 },
                      items: [{ content: { id: "video-1", title: "synthetic" } }],
                    },
                  },
                },
              },
            });
          };
          try {
            const result = await details.func(...(details.args ?? []));
            return [{ result }];
          } finally {
            globalThis.fetch = pageFetch;
          }
        },
      },
    };

    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.startsWith("http://127.0.0.1:41321/api/import/fanza_video")) {
        return json({ inserted: 1, updated: 0, itemCount: 1, totalCount: 1, hasNext: false });
      }
      if (url.startsWith("http://127.0.0.1:41321/api/sync-state/fanza_video")) {
        return json({ cursor: null, lastSyncedAt: "2026-01-01T00:00:00.000Z" });
      }
      return json({}, 403);
    };

    try {
      const outcome = await runFanzaVideoSync();
      assert.equal(outcome.ok, true);
      assert.equal(outcome.fetched, 1);
      assert.equal(pageRequest?.input, "https://api.video.dmm.co.jp/graphql");
      assert.equal(pageRequest?.init?.credentials, "include");
      assert.equal(removedTab, true);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousChrome === undefined) delete globalWithChrome.chrome;
      else globalWithChrome.chrome = previousChrome;
    }
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
            itemCount: 1,
            totalCount: 2,
          });
        }
        if (source === "fanza_doujin" || source === "fanza_video") {
          const page = (pageBySource.get(`${source}:import`) ?? 0) + 1;
          pageBySource.set(`${source}:import`, page);
          return json({
            inserted: 1,
            updated: 0,
            hasNext: page === 1,
            itemCount: 1,
            totalCount: 2,
          });
        }
        if (source === "fanza_dlsoft") {
          return json({ inserted: 1, updated: 0, itemCount: 1, totalCount: 2 });
        }
        // Books contents import
        return json({ inserted: 1, updated: 0, hasNext: false, itemCount: 1, totalCount: 1 });
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

  it("uses the accepted Books contents shop before importing purchased volumes", async () => {
    const previousFetch = globalThis.fetch;
    const fixture = JSON.parse(
      readFileSync(
        new URL("../../../../shared/test/fixtures/fanza-books-import.json", import.meta.url),
        "utf8",
      ),
    ) as { payload: unknown };
    const contentsShops: string[] = [];
    let volumeImportCalls = 0;
    let markedBooks = false;

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("book.dmm.co.jp/ajax/bff/library/")) {
        return json({
          series_books: [{ series_id: "synthetic-series" }],
          pager: { page: 1, per_page: 20, total_count: 1 },
        });
      }
      if (url.includes("book.dmm.co.jp/ajax/bff/contents/")) {
        const shop = new URL(url).searchParams.get("shop_name") ?? "";
        contentsShops.push(shop);
        return shop === "adult" ? json(fixture.payload) : json({ error: "invalid_shop" }, 400);
      }
      if (url.startsWith("http://127.0.0.1:41321/api/import/fanza_books")) {
        const body = JSON.parse(String(init?.body));
        if ("series_books" in body) {
          return json({
            inserted: 0,
            updated: 0,
            series: [{
              seriesId: "synthetic-series",
              author: "synthetic-author",
              seriesRaw: { series_id: "synthetic-series" },
            }],
            itemCount: 1,
            totalCount: 1,
            hasNext: false,
          });
        }
        volumeImportCalls += 1;
        return json({ inserted: 1, updated: 0, itemCount: 1, totalCount: 1, hasNext: false });
      }
      if (url.startsWith("http://127.0.0.1:41321/api/sync-state/fanza_books")) {
        markedBooks = true;
        return json({ cursor: null, lastSyncedAt: "2026-01-01T00:00:00.000Z" });
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    try {
      const outcome = await runFanzaBooksSync();
      assert.deepEqual(contentsShops, ["adult"]);
      assert.equal(volumeImportCalls, 1);
      assert.equal(markedBooks, true);
      assert.deepEqual(outcome, {
        ok: true,
        counts: { inserted: 1, updated: 0 },
        fetched: 2,
      });
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
          return json({
            inserted: 0,
            updated: 0,
            series: [],
            hasNext: false,
            itemCount: 0,
            totalCount: 0,
          });
        }
      }
      if (url.startsWith("http://127.0.0.1:41321/api/import/")) {
        return json({ inserted: 0, updated: 0, itemCount: 0, totalCount: 0, hasNext: false });
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
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/sync-state/full_sync")) {
        return json({
          cursor: null,
          lastSyncedAt: null,
          latestOutcome: null,
        });
      }
      return json({
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
    };
    const container = { textContent: "" } as HTMLElement;
    try {
      await renderSyncStatus(container);
      assert.match(container.textContent, /FANZA 同人: エラー synthetic_failure/);
      assert.match(container.textContent, /新規 2 \/ 更新 1/);
      assert.doesNotMatch(container.textContent, /全体:/);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("immediate manual sync renders per-source rows plus full-sync global error", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      json({ cursor: null, lastSyncedAt: "2026-01-01T00:00:00.000Z", latestOutcome: null });
    const container = { textContent: "" } as HTMLElement;
    try {
      await renderSyncStatus(
        container,
        {
          dlsite: { ok: true, counts: { inserted: 1, updated: 0 }, fetched: 1 },
          fanza_doujin: { ok: true, counts: { inserted: 0, updated: 0 }, fetched: 1 },
          fanza_books: { ok: true, counts: { inserted: 0, updated: 0 }, fetched: 1 },
          fanza_video: { ok: true, counts: { inserted: 0, updated: 0 }, fetched: 1 },
          fanza_dlsoft: { ok: true, counts: { inserted: 0, updated: 0 }, fetched: 1 },
        },
        "rematch_failed",
      );
      assert.match(container.textContent, /DLsite:/);
      assert.match(container.textContent, /FANZA 同人:/);
      assert.match(container.textContent, /全体: エラー rematch_failed/);
      // Global rematch failure must not be labeled as a marketplace source.
      assert.doesNotMatch(container.textContent, /DLsite: エラー rematch_failed/);
      assert.doesNotMatch(container.textContent, /FANZA 同人: エラー rematch_failed/);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("popup reopen renders the latest persisted global failure", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/api/sync-state/full_sync")) {
        return json({
          cursor: null,
          lastSyncedAt: "2026-02-01T00:00:00.000Z",
          latestOutcome: {
            ok: false,
            counts: { inserted: 0, updated: 0 },
            error: "rematch_failed",
            fetched: null,
            recordedAt: "2026-02-01T00:00:00.000Z",
          },
        });
      }
      return json({
        cursor: null,
        lastSyncedAt: "2026-01-01T00:00:00.000Z",
        latestOutcome: {
          ok: true,
          counts: { inserted: 1, updated: 0 },
          error: null,
          fetched: 1,
          recordedAt: "2026-01-01T00:00:00.000Z",
        },
      });
    };
    const container = { textContent: "" } as HTMLElement;
    try {
      await renderSyncStatus(container);
      assert.match(container.textContent, /DLsite:/);
      assert.match(container.textContent, /全体: エラー rematch_failed/);
      assert.doesNotMatch(container.textContent, /FANZA 同人: エラー rematch_failed/);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("successful later full sync clears stale global error in the immediate view", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      // Stale persisted global failure must not appear when success is explicit.
      if (url.includes("/api/sync-state/full_sync")) {
        return json({
          cursor: null,
          lastSyncedAt: "2026-02-01T00:00:00.000Z",
          latestOutcome: {
            ok: false,
            counts: { inserted: 0, updated: 0 },
            error: "rematch_failed",
            fetched: null,
            recordedAt: "2026-02-01T00:00:00.000Z",
          },
        });
      }
      return json({ cursor: null, lastSyncedAt: "2026-03-01T00:00:00.000Z", latestOutcome: null });
    };
    const container = { textContent: "" } as HTMLElement;
    try {
      await renderSyncStatus(
        container,
        {
          dlsite: { ok: true, counts: { inserted: 0, updated: 0 }, fetched: 1 },
          fanza_doujin: { ok: true, counts: { inserted: 0, updated: 0 }, fetched: 1 },
          fanza_books: { ok: true, counts: { inserted: 0, updated: 0 }, fetched: 1 },
          fanza_video: { ok: true, counts: { inserted: 0, updated: 0 }, fetched: 1 },
          fanza_dlsoft: { ok: true, counts: { inserted: 0, updated: 0 }, fetched: 1 },
        },
        null,
      );
      assert.match(container.textContent, /DLsite:/);
      assert.doesNotMatch(container.textContent, /全体:/);
      assert.doesNotMatch(container.textContent, /rematch_failed/);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("passes failed full-sync source outcomes and global error to popup rendering", () => {
    const popupSource = readFileSync(
      new URL("../../popup/popup.ts", import.meta.url),
      "utf8",
    );
    assert.match(popupSource, /if \(outcome\?\.sources\) \{/);
    assert.match(popupSource, /outcome\.error \?\? null/);
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
        return json({
          inserted: 0,
          updated: 0,
          series: [],
          hasNext: false,
          itemCount: 0,
          totalCount: 0,
        });
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

  it("treats Doujin/Books/Video empty pages with total=2 as source errors after bounded calls", async () => {
    const previousFetch = globalThis.fetch;
    const storeCalls = { doujin: 0, books: 0, video: 0 };
    const marked = { doujin: false, books: false, video: false };

    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.startsWith("http://127.0.0.1:41321/api/import/fanza_doujin")) {
        return json({ inserted: 0, updated: 0, itemCount: 0, totalCount: 2, hasNext: true });
      }
      if (url.startsWith("http://127.0.0.1:41321/api/import/fanza_books")) {
        return json({
          inserted: 0,
          updated: 0,
          series: [],
          itemCount: 0,
          totalCount: 2,
          hasNext: true,
        });
      }
      if (url.startsWith("http://127.0.0.1:41321/api/import/fanza_video")) {
        return json({ inserted: 0, updated: 0, itemCount: 0, totalCount: 2, hasNext: true });
      }
      if (url.startsWith("http://127.0.0.1:41321/api/import/fanza_dlsoft")) {
        return json({ inserted: 0, updated: 0, itemCount: 0, totalCount: 0 });
      }
      if (url.startsWith("http://127.0.0.1:41321/api/sync-state/fanza_doujin")) {
        marked.doujin = true;
        return json({ cursor: null, lastSyncedAt: "2026-01-01T00:00:00.000Z" });
      }
      if (url.startsWith("http://127.0.0.1:41321/api/sync-state/fanza_books")) {
        marked.books = true;
        return json({ cursor: null, lastSyncedAt: "2026-01-01T00:00:00.000Z" });
      }
      if (url.startsWith("http://127.0.0.1:41321/api/sync-state/fanza_video")) {
        marked.video = true;
        return json({ cursor: null, lastSyncedAt: "2026-01-01T00:00:00.000Z" });
      }
      if (url.startsWith("http://127.0.0.1:41321/api/sync-state/")) {
        return json({ cursor: null, lastSyncedAt: "2026-01-01T00:00:00.000Z" });
      }
      if (url.includes("/dc/doujin/")) {
        storeCalls.doujin += 1;
        return json({ error_code: 0, data: { items: {}, total: 2, hasNext: true } });
      }
      if (url.includes("book.dmm.co.jp")) {
        storeCalls.books += 1;
        return json({ series_books: [], pager: { page: 1, per_page: 1, total_count: 2 } });
      }
      if (url.includes("api.video.dmm.co.jp")) {
        storeCalls.video += 1;
        return json({
          data: { user: { ppvLibrary: { contentViewingRightsSummaryList: {
            pageInfo: { hasNext: true, totalCount: 2 }, items: [],
          } } } },
        });
      }
      return json({ error: null, body: { totalCount: 0, library: [] } });
    };

    try {
      const outcomes = await runAllFanzaSyncs();
      for (const source of ["fanza_doujin", "fanza_books", "fanza_video"] as const) {
        assert.equal(outcomes[source]?.ok, false, source);
        assert.equal(outcomes[source]?.error, "empty_page_positive_total", source);
        assert.equal(outcomes[source]?.fetched, 1, source);
      }
      assert.equal(storeCalls.doujin, 1);
      assert.equal(storeCalls.books, 1);
      assert.equal(storeCalls.video, 1);
      assert.equal(marked.doujin, false);
      assert.equal(marked.books, false);
      assert.equal(marked.video, false);
      assert.equal(outcomes.fanza_dlsoft?.ok, true);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("allows terminal empty pages when total=0 for Doujin/Books/Video", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.startsWith("http://127.0.0.1:41321/api/import/")) {
        if (url.includes("fanza_books")) {
          return json({
            inserted: 0,
            updated: 0,
            series: [],
            itemCount: 0,
            totalCount: 0,
            hasNext: false,
          });
        }
        return json({ inserted: 0, updated: 0, itemCount: 0, totalCount: 0, hasNext: false });
      }
      if (url.startsWith("http://127.0.0.1:41321/api/sync-state/")) {
        return json({ cursor: null, lastSyncedAt: "2026-01-01T00:00:00.000Z" });
      }
      if (url.includes("/dc/doujin/")) {
        return json({ error_code: 0, data: { items: {}, total: 0, hasNext: false } });
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
      assert.ok(Object.values(outcomes).every((outcome) => outcome.ok));
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("stops Doujin/Video when hasNext stays true after total is satisfied (bounded)", async () => {
    const previousFetch = globalThis.fetch;
    const storeCalls = { doujin: 0, video: 0 };

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith("http://127.0.0.1:41321/api/import/fanza_doujin")) {
        return json({
          inserted: 1,
          updated: 0,
          itemCount: 1,
          totalCount: 2,
          hasNext: true,
        });
      }
      if (url.startsWith("http://127.0.0.1:41321/api/import/fanza_video")) {
        return json({
          inserted: 1,
          updated: 0,
          itemCount: 1,
          totalCount: 2,
          hasNext: true,
        });
      }
      if (url.startsWith("http://127.0.0.1:41321/api/import/fanza_books")) {
        const body = JSON.parse(String(init?.body));
        if ("series_books" in body) {
          return json({
            inserted: 0,
            updated: 0,
            series: [],
            itemCount: 0,
            totalCount: 0,
            hasNext: false,
          });
        }
        return json({ inserted: 0, updated: 0, itemCount: 0, totalCount: 0, hasNext: false });
      }
      if (url.startsWith("http://127.0.0.1:41321/api/import/fanza_dlsoft")) {
        return json({ inserted: 0, updated: 0, itemCount: 0, totalCount: 0 });
      }
      if (url.startsWith("http://127.0.0.1:41321/api/sync-state/")) {
        return json({ cursor: null, lastSyncedAt: "2026-01-01T00:00:00.000Z" });
      }
      if (url.includes("/dc/doujin/")) {
        storeCalls.doujin += 1;
        return json({
          error_code: 0,
          data: {
            items: { "2026年01月01日": [{ contentId: `d-${storeCalls.doujin}`, title: "synthetic" }] },
            total: 2,
            hasNext: true,
          },
        });
      }
      if (url.includes("book.dmm.co.jp")) {
        return json({ series_books: [], pager: { page: 1, per_page: 1, total_count: 0 } });
      }
      if (url.includes("api.video.dmm.co.jp")) {
        storeCalls.video += 1;
        return json({
          data: { user: { ppvLibrary: { contentViewingRightsSummaryList: {
            pageInfo: { hasNext: true, totalCount: 2 },
            items: [{ content: { id: `v-${storeCalls.video}`, title: "synthetic" } }],
          } } } },
        });
      }
      return json({ error: null, body: { totalCount: 0, library: [] } });
    };

    try {
      const outcomes = await runAllFanzaSyncs();
      assert.equal(outcomes.fanza_doujin?.ok, true);
      assert.equal(outcomes.fanza_video?.ok, true);
      assert.equal(storeCalls.doujin, 2);
      assert.equal(storeCalls.video, 2);
      assert.equal(outcomes.fanza_doujin?.fetched, 2);
      assert.equal(outcomes.fanza_video?.fetched, 2);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("fails Books library when the same series repeats under non-advancing pagination", async () => {
    const previousFetch = globalThis.fetch;
    let libraryCalls = 0;
    let markedBooks = false;

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith("http://127.0.0.1:41321/api/import/fanza_books")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        if ("series_books" in body) {
          return json({
            inserted: 0,
            updated: 0,
            series: [{
              seriesId: "repeated-series",
              author: null,
              seriesRaw: { series_id: "repeated-series" },
            }],
            itemCount: 1,
            totalCount: 5,
            hasNext: true,
          });
        }
        return json({ inserted: 0, updated: 0, itemCount: 0, totalCount: 0, hasNext: false });
      }
      if (url.startsWith("http://127.0.0.1:41321/api/import/")) {
        return json({ inserted: 0, updated: 0, itemCount: 0, totalCount: 0, hasNext: false });
      }
      if (url.startsWith("http://127.0.0.1:41321/api/sync-state/fanza_books")) {
        markedBooks = true;
        return json({ cursor: null, lastSyncedAt: "2026-01-01T00:00:00.000Z" });
      }
      if (url.startsWith("http://127.0.0.1:41321/api/sync-state/")) {
        return json({ cursor: null, lastSyncedAt: "2026-01-01T00:00:00.000Z" });
      }
      if (url.includes("/dc/doujin/")) {
        return json({ error_code: 0, data: { items: {}, total: 0, hasNext: false } });
      }
      if (url.includes("book.dmm.co.jp") && url.includes("/library/")) {
        libraryCalls += 1;
        return json({
          series_books: [{ series_id: "repeated-series" }],
          pager: { page: 1, per_page: 1, total_count: 5 },
        });
      }
      if (url.includes("book.dmm.co.jp")) {
        return json({ volume_books: [], pager: { page: 1, per_page: 100, total_count: 0 } });
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
      assert.equal(outcomes.fanza_books?.ok, false);
      assert.equal(outcomes.fanza_books?.error, "pagination_no_progress");
      assert.equal(libraryCalls, 2);
      assert.equal(markedBooks, false);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("fails Books contents empty page with positive remaining total", async () => {
    const previousFetch = globalThis.fetch;
    let contentsCalls = 0;
    let markedBooks = false;

    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.startsWith("http://127.0.0.1:41321/api/import/fanza_books")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        if ("series_books" in body) {
          return json({
            inserted: 0,
            updated: 0,
            series: [{
              seriesId: "series-with-empty-contents",
              author: null,
              seriesRaw: { series_id: "series-with-empty-contents" },
            }],
            itemCount: 1,
            totalCount: 1,
            hasNext: false,
          });
        }
        return json({
          inserted: 0,
          updated: 0,
          itemCount: 0,
          totalCount: 2,
          hasNext: true,
        });
      }
      if (url.startsWith("http://127.0.0.1:41321/api/import/")) {
        return json({ inserted: 0, updated: 0, itemCount: 0, totalCount: 0, hasNext: false });
      }
      if (url.startsWith("http://127.0.0.1:41321/api/sync-state/fanza_books")) {
        markedBooks = true;
        return json({ cursor: null, lastSyncedAt: "2026-01-01T00:00:00.000Z" });
      }
      if (url.startsWith("http://127.0.0.1:41321/api/sync-state/")) {
        return json({ cursor: null, lastSyncedAt: "2026-01-01T00:00:00.000Z" });
      }
      if (url.includes("/dc/doujin/")) {
        return json({ error_code: 0, data: { items: {}, total: 0, hasNext: false } });
      }
      if (url.includes("book.dmm.co.jp") && url.includes("/library/")) {
        return json({
          series_books: [{ series_id: "series-with-empty-contents" }],
          pager: { page: 1, per_page: 20, total_count: 1 },
        });
      }
      if (url.includes("book.dmm.co.jp") && url.includes("/contents/")) {
        contentsCalls += 1;
        return json({
          volume_books: [],
          pager: { page: 1, per_page: 100, total_count: 2 },
        });
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
      assert.equal(outcomes.fanza_books?.ok, false);
      assert.equal(outcomes.fanza_books?.error, "empty_page_positive_total");
      assert.equal(contentsCalls, 1);
      assert.equal(markedBooks, false);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
