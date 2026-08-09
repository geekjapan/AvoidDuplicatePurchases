import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getOrCreateTab,
  runLibrarySync,
  type LibrarySyncDeps,
} from "./library-sync.js";
import type { LibraryDomItem, LibraryPageReply } from "../messages.js";

const AMAZON_START = "https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll/";
const PAGE_2 = `${AMAZON_START}?pageNumber=2`;
const KOBO_START = "https://books.rakuten.co.jp/e-book/kobo/library/";
const EBOOKJAPAN_START = "https://ebookjapan.yahoo.co.jp/bookshelf/";

const ITEM: LibraryDomItem = { cid: "SYNTHETI01", title: "合成本", state: "purchased" };

function ready(
  items: LibraryDomItem[],
  nextPageUrl: string | null,
  pageUrl: string,
): LibraryPageReply {
  return { ok: true, state: "ready", pageUrl, items, nextPageUrl };
}

function depsWith(
  readPage: (tabId: number, source: string) => Promise<LibraryPageReply | null>,
  overrides: Partial<LibrarySyncDeps> = {},
): LibrarySyncDeps {
  return {
    getOrCreateTab: async () => 7,
    navigateTab: async () => {},
    readPage,
    importBatch: async (source, pageUrl, items) => ({
      ok: true,
      counts: {
        observed: items.length,
        inserted: items.length,
        updated: 0,
        byState: { purchased: items.length },
      },
    }),
    rematch: async () => true,
    markSynced: async () => true,
    pollIntervalMs: 1,
    readinessTimeoutMs: 2000,
    ...overrides,
  };
}

describe("background DOM library sync", () => {
  it("imports a multi-batch run and rematches only after success", async () => {
    const navigated: string[] = [];
    let importCalls = 0;
    let rematchCalls = 0;
    let markSyncedCalls = 0;
    const replies = new Map<string, LibraryPageReply>([
      [AMAZON_START, ready([ITEM], PAGE_2, AMAZON_START)],
      // Cycles back to the visited start URL → the visited-URL guard stops.
      [PAGE_2, ready([{ ...ITEM, cid: "SYNTHETI02" }], AMAZON_START, PAGE_2)],
    ]);
    const outcome = await runLibrarySync("amazon", {
      ...depsWith(async (tabId, source) => {
        assert.equal(source, "amazon");
        return replies.get(navigated[navigated.length - 1]!) ?? null;
      }),
      navigateTab: async (_tabId, url) => {
        navigated.push(url);
      },
      importBatch: async (source, pageUrl, items) => {
        importCalls++;
        assert.equal(source, "amazon");
        assert.ok(pageUrl.startsWith(AMAZON_START));
        return {
          ok: true,
          counts: {
            observed: items.length,
            inserted: items.length,
            updated: 0,
            byState: { purchased: items.length },
          },
        };
      },
      rematch: async () => {
        rematchCalls++;
        return true;
      },
      markSynced: async () => {
        markSyncedCalls++;
        return true;
      },
    });

    assert.deepEqual(navigated, [AMAZON_START, PAGE_2]);
    assert.equal(importCalls, 2);
    assert.equal(rematchCalls, 1);
    assert.equal(markSyncedCalls, 1);
    assert.deepEqual(outcome, {
      ok: true,
      source: "amazon",
      pages: 2,
      observed: 2,
      inserted: 2,
      updated: 0,
    });
  });

  it("aborts on a login page without importing or rematching", async () => {
    const outcome = await runLibrarySync("amazon", {
      ...depsWith(async () => ({
        ok: true,
        state: "login" as const,
        pageUrl: "https://www.amazon.co.jp/ap/signin",
      })),
      importBatch: async () => {
        throw new Error("must not import");
      },
      rematch: async () => {
        throw new Error("must not rematch");
      },
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, "library_login_required");
    assert.equal(outcome.pages, 0);
  });

  it("treats an empty library as a successful zero-item sync", async () => {
    let rematchCalls = 0;
    let markSyncedCalls = 0;
    const outcome = await runLibrarySync("kobo", {
      ...depsWith(async () => ({
        ok: true,
        state: "empty" as const,
        pageUrl: KOBO_START,
        items: [],
        nextPageUrl: null,
      })),
      importBatch: async () => {
        throw new Error("must not import");
      },
      rematch: async () => {
        rematchCalls++;
        return true;
      },
      markSynced: async () => {
        markSyncedCalls++;
        return true;
      },
    });
    assert.deepEqual(outcome, {
      ok: true,
      source: "kobo",
      pages: 1,
      observed: 0,
      inserted: 0,
      updated: 0,
    });
    assert.equal(rematchCalls, 0, "no successful batch → no rematch");
    assert.equal(markSyncedCalls, 1, "a fully read empty page still advances sync state");
  });

  it("waits for content-script readiness across page_not_ready polls", async () => {
    let polls = 0;
    const outcome = await runLibrarySync("ebookjapan", {
      ...depsWith(async () => {
        polls++;
        if (polls < 3) {
          return { ok: true, state: "page_not_ready" as const, pageUrl: EBOOKJAPAN_START };
        }
        return ready([ITEM], null, EBOOKJAPAN_START);
      }),
    });
    assert.equal(polls, 3);
    assert.deepEqual(outcome, {
      ok: true,
      source: "ebookjapan",
      pages: 1,
      observed: 1,
      inserted: 1,
      updated: 0,
    });
  });

  it("reports readiness timeout when the page never becomes ready", async () => {
    const outcome = await runLibrarySync("amazon", {
      ...depsWith(async () => ({
        ok: true,
        state: "page_not_ready" as const,
        pageUrl: AMAZON_START,
      })),
      pollIntervalMs: 1,
      readinessTimeoutMs: 30,
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, "library_readiness_timeout");
  });

  it("rejects invalid polling configuration before opening a tab", async () => {
    for (const overrides of [
      { pollIntervalMs: 0 },
      { pollIntervalMs: -1 },
      { pollIntervalMs: 1.5 },
      { readinessTimeoutMs: 0 },
      { readinessTimeoutMs: -1 },
    ]) {
      let opened = false;
      const outcome = await runLibrarySync("amazon", {
        ...overrides,
        getOrCreateTab: async () => {
          opened = true;
          return 7;
        },
      });
      assert.equal(outcome.error, "library_invalid_poll_config");
      assert.equal(opened, false);
    }
  });

  it("returns immediately when readiness poll receives ok:false", async () => {
    let polls = 0;
    const started = Date.now();
    const outcome = await runLibrarySync("amazon", {
      ...depsWith(async () => {
        polls++;
        return { ok: false as const, error: "library_reader_unregistered" };
      }),
      pollIntervalMs: 50,
      readinessTimeoutMs: 2000,
    });
    const elapsed = Date.now() - started;
    assert.equal(polls, 1, "must not keep polling after ok:false");
    assert.ok(elapsed < 500, `should not wait for readiness timeout (elapsed=${elapsed}ms)`);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, "library_reader_unregistered");
  });

  it("reports failure when no content script answers", async () => {
    const outcome = await runLibrarySync("amazon", {
      ...depsWith(async () => null),
      pollIntervalMs: 1,
      readinessTimeoutMs: 30,
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, "library_read_failed");
  });

  it("fail-closes malformed ok:true/ok:false shapes via default readPage schema", async () => {
    const originalSend = (globalThis as { chrome?: unknown }).chrome;
    let polls = 0;
    (globalThis as { chrome: unknown }).chrome = {
      tabs: {
        sendMessage: async () => {
          polls++;
          // Missing items on ready is a malformed ok:true shape.
          return { ok: true, state: "ready", pageUrl: AMAZON_START, nextPageUrl: null };
        },
      },
    };
    try {
      const outcome = await runLibrarySync("amazon", {
        getOrCreateTab: async () => 1,
        navigateTab: async () => {},
        // Use production readPage (no deps.readPage override).
        importBatch: async () => ({
          ok: true,
          counts: { observed: 0, inserted: 0, updated: 0, byState: {} },
        }),
        rematch: async () => true,
        markSynced: async () => true,
        pollIntervalMs: 1,
        readinessTimeoutMs: 2000,
      });
      assert.equal(outcome.ok, false);
      assert.equal(outcome.error, "library_read_failed");
      assert.equal(polls, 1, "must not keep polling after schema failure");
    } finally {
      if (originalSend === undefined) {
        delete (globalThis as { chrome?: unknown }).chrome;
      } else {
        (globalThis as { chrome: unknown }).chrome = originalSend;
      }
    }
  });

  it("aborts when a batch import fails, without rematching", async () => {
    let rematchCalls = 0;
    const outcome = await runLibrarySync("amazon", {
      ...depsWith(async () => ready([ITEM], PAGE_2, AMAZON_START)),
      importBatch: async () => ({ ok: false, error: "http_500" }),
      rematch: async () => {
        rematchCalls++;
        return true;
      },
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, "http_500");
    assert.equal(rematchCalls, 0);
  });

  it("enforces the maximum-page guard on endless pagination", async () => {
    let rematchCalls = 0;
    let markSyncedCalls = 0;
    let page = 1;
    let currentPageUrl = AMAZON_START;
    const outcome = await runLibrarySync("amazon", {
      ...depsWith(async () =>
        ready([ITEM], `${AMAZON_START}?pageNumber=${++page}`, currentPageUrl),
      ),
      navigateTab: async (_tabId, url) => {
        currentPageUrl = url;
      },
      maxPages: 3,
      rematch: async () => {
        rematchCalls++;
        return true;
      },
      markSynced: async () => {
        markSyncedCalls++;
        return true;
      },
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, "library_max_pages_exceeded");
    assert.equal(outcome.pages, 3);
    assert.equal(outcome.observed, 3);
    assert.equal(rematchCalls, 0);
    assert.equal(markSyncedCalls, 0);
  });

  it("reports rematch and mark-synced failures instead of succeeding", async () => {
    const rematchFailed = await runLibrarySync("amazon", {
      ...depsWith(async () => ready([ITEM], null, AMAZON_START)),
      rematch: async () => false,
      markSynced: async () => {
        throw new Error("must not mark after rematch failure");
      },
    });
    assert.equal(rematchFailed.ok, false);
    assert.equal(rematchFailed.error, "library_rematch_failed");

    const markFailed = await runLibrarySync("amazon", {
      ...depsWith(async () => ready([ITEM], null, AMAZON_START)),
      rematch: async () => true,
      markSynced: async () => false,
    });
    assert.equal(markFailed.ok, false);
    assert.equal(markFailed.error, "library_mark_synced_failed");
  });

  it("rejects non-canonical reply.pageUrl before counting ready as success", async () => {
    let importCalls = 0;
    let rematchCalls = 0;
    const wrongHost = await runLibrarySync("amazon", {
      ...depsWith(async () =>
        ready([ITEM], null, "https://www.amazon.com/hz/mycd/digital-console/contentlist/booksAll/"),
      ),
      importBatch: async () => {
        importCalls++;
        throw new Error("must not import");
      },
      rematch: async () => {
        rematchCalls++;
        return true;
      },
    });
    assert.equal(wrongHost.ok, false);
    assert.equal(wrongHost.error, "library_page_url_invalid");
    assert.equal(wrongHost.pages, 0);
    assert.equal(importCalls, 0);
    assert.equal(rematchCalls, 0);

    const mismatched = await runLibrarySync("amazon", {
      ...depsWith(async () => ready([ITEM], null, PAGE_2)),
      importBatch: async () => {
        throw new Error("must not import");
      },
    });
    assert.equal(mismatched.ok, false);
    assert.equal(mismatched.error, "library_page_url_invalid");
    assert.equal(mismatched.pages, 0);

    const wrongPath = await runLibrarySync("kobo", {
      ...depsWith(async () =>
        ready([ITEM], null, "https://books.rakuten.co.jp/e-book/mylibrary/"),
      ),
      importBatch: async () => {
        throw new Error("must not import");
      },
    });
    assert.equal(wrongPath.ok, false);
    assert.equal(wrongPath.error, "library_page_url_invalid");
    assert.equal(wrongPath.pages, 0);

    // A ready reply for one source reporting another source's canonical URL
    // is a wrong-source reply and fails closed too.
    const wrongSource = await runLibrarySync("kobo", {
      ...depsWith(async () => ready([ITEM], null, AMAZON_START)),
      importBatch: async () => {
        throw new Error("must not import");
      },
    });
    assert.equal(wrongSource.ok, false);
    assert.equal(wrongSource.error, "library_page_url_invalid");
    assert.equal(wrongSource.pages, 0);
  });

  it("rejects non-canonical nextPageUrl instead of following it", async () => {
    let rematchCalls = 0;
    const retainedQuery = await runLibrarySync("kobo", {
      ...depsWith(async () =>
        ready(
          [ITEM],
          "https://books.rakuten.co.jp/e-book/kobo/library/?code=REDACTED",
          KOBO_START,
        ),
      ),
      rematch: async () => {
        rematchCalls++;
        return true;
      },
    });
    assert.equal(retainedQuery.ok, false);
    assert.equal(retainedQuery.error, "library_page_url_invalid");
    assert.equal(retainedQuery.pages, 1);
    assert.equal(rematchCalls, 0, "invalid next URL must not rematch");

    const wrongHostNext = await runLibrarySync("ebookjapan", {
      ...depsWith(async () =>
        ready([ITEM], "https://evil.example.com/bookshelf/", EBOOKJAPAN_START),
      ),
      rematch: async () => {
        throw new Error("must not rematch");
      },
    });
    assert.equal(wrongHostNext.ok, false);
    assert.equal(wrongHostNext.error, "library_page_url_invalid");
  });

  it("accepts canonical pagination for every library source", async () => {
    let ebookjapanPageUrl = EBOOKJAPAN_START;
    const ebookjapan = await runLibrarySync("ebookjapan", {
      ...depsWith(async () =>
        ready([ITEM], `${EBOOKJAPAN_START}?page=2`, ebookjapanPageUrl),
      ),
      navigateTab: async (_tabId, url) => {
        ebookjapanPageUrl = url;
      },
      markSynced: async () => true,
    });
    assert.equal(ebookjapan.ok, true);
    assert.equal(ebookjapan.pages, 2);
    assert.equal(ebookjapan.observed, 2);

    let koboPageUrl = KOBO_START;
    const kobo = await runLibrarySync("kobo", {
      ...depsWith(async () =>
        ready(
          [ITEM],
          "https://books.rakuten.co.jp/e-book/kobo/library/page/2",
          koboPageUrl,
        ),
      ),
      navigateTab: async (_tabId, url) => {
        koboPageUrl = url;
      },
      markSynced: async () => true,
    });
    assert.equal(kobo.ok, true);
    assert.equal(kobo.pages, 2);
    assert.equal(kobo.observed, 2);
  });

  it("rejects unknown providers before any tab is touched", async () => {
    const outcome = await runLibrarySync("dlsite" as never, {
      getOrCreateTab: async () => {
        throw new Error("must not open a tab");
      },
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, "library_unknown_provider");
  });

  it("reuses only a tab whose parsed origin exactly matches the provider", async () => {
    const chromeGlobal = globalThis as { chrome?: unknown };
    const originalChrome = chromeGlobal.chrome;
    let created = 0;
    chromeGlobal.chrome = {
      tabs: {
        query: async () => [
          { id: 1, url: "https://books.rakuten.co.jp.evil.example/" },
          { id: 2, url: KOBO_START },
        ],
        create: async () => {
          created++;
          return { id: 3 };
        },
      },
    };
    try {
      assert.equal(await getOrCreateTab(KOBO_START), 2);
      assert.equal(created, 0);

      chromeGlobal.chrome = {
        tabs: {
          query: async () => [{ id: 1, url: "https://books.rakuten.co.jp.evil.example/" }],
          create: async () => {
            created++;
            return { id: 3 };
          },
        },
      };
      assert.equal(await getOrCreateTab(KOBO_START), 3);
      assert.equal(created, 1);
    } finally {
      if (originalChrome === undefined) delete chromeGlobal.chrome;
      else chromeGlobal.chrome = originalChrome;
    }
  });

  it("fails closed when no tab is available", async () => {
    const outcome = await runLibrarySync("amazon", {
      ...depsWith(async () => ready([ITEM], null, AMAZON_START)),
      getOrCreateTab: async () => null,
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, "library_no_tab");
  });
});
