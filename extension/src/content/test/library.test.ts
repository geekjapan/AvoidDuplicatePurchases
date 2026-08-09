import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  handleLibraryReadPage,
  registerLibraryPageReader,
  safeLoginPageUrl,
  safeNextPageUrl,
  LIBRARY_BATCH_MAX,
} from "../library.js";
import type { LibraryDomItem, LibraryPageReply } from "../../messages.js";

const READY_URL = "https://ebookjapan.yahoo.co.jp/bookshelf/?page=1";
const READY_URL_2 = "https://ebookjapan.yahoo.co.jp/bookshelf/?page=2";

function readyReply(
  items: LibraryDomItem[],
  nextPageUrl: string | null,
): LibraryPageReply {
  return { ok: true, state: "ready", pageUrl: READY_URL, items, nextPageUrl };
}

function makeReader(overrides: Partial<Parameters<typeof registerLibraryPageReader>[0]> = {}) {
  return {
    source: "ebookjapan" as const,
    matchesLibraryUrl: (url: string) => url.includes("ebookjapan.yahoo.co.jp"),
    readPage: () => readyReply([], null),
    ...overrides,
  };
}

describe("content library-sync protocol (generic layer)", () => {
  it("reports an unregistered provider without touching the DOM", () => {
    const reply = handleLibraryReadPage("amazon", {}, READY_URL);
    assert.deepEqual(reply, { ok: false, error: "library_reader_unregistered" });
  });

  it("maps a URL outside the provider library page to login", () => {
    const unregister = registerLibraryPageReader(
      makeReader({
        readPage: () => {
          throw new Error("must not read DOM when the URL gate fails");
        },
      }),
    );
    const reply = handleLibraryReadPage("ebookjapan", {}, "https://login.yahoo.co.jp/config/login");
    assert.deepEqual(reply, { ok: true, state: "login", pageUrl: "https://login.yahoo.co.jp/config/login" });
    unregister();
  });

  it("never returns query/hash/credentials on the login response boundary", () => {
    const unregister = registerLibraryPageReader(
      makeReader({
        readPage: () => {
          throw new Error("must not read DOM when the URL gate fails");
        },
      }),
    );
    const unsafe =
      "https://login.yahoo.co.jp/config/login?code=REDACTED_AUTH_CODE&state=x#frag";
    const reply = handleLibraryReadPage("ebookjapan", {}, unsafe);
    assert.deepEqual(reply, {
      ok: true,
      state: "login",
      pageUrl: "https://login.yahoo.co.jp/config/login",
    });
    assert.equal(safeLoginPageUrl(unsafe), "https://login.yahoo.co.jp/config/login");
    assert.equal(
      safeLoginPageUrl("https://user:pass@login.yahoo.co.jp/config/login?code=x"),
      "",
    );
    assert.equal(safeLoginPageUrl("http://login.yahoo.co.jp/config/login"), "");
    assert.equal(safeLoginPageUrl("not a url"), "");
    unregister();
  });

  it("passes ready batches through with every explicit state preserved", () => {
    const states: LibraryDomItem[] = [
      { cid: "P1", title: "購入", state: "purchased" },
      { cid: "R1", title: "レンタル", state: "rental" },
      { cid: "U1", title: "判定不能", state: "unknown" },
    ];
    const unregister = registerLibraryPageReader(
      makeReader({ readPage: () => readyReply(states, READY_URL_2) }),
    );
    const reply = handleLibraryReadPage("ebookjapan", {}, READY_URL);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.deepEqual(reply.items, states);
    assert.equal(reply.nextPageUrl, READY_URL_2);
    unregister();
  });

  it("rejects unsafe next-page targets (http, cross-host, credentials, non-default port)", () => {
    const cases: Array<[string | null, string | null]> = [
      ["http://ebookjapan.yahoo.co.jp/bookshelf/?page=2", null],
      ["https://evil.example.com/bookshelf/?page=2", null],
      ["https://user@ebookjapan.yahoo.co.jp/bookshelf/?page=2", null],
      ["https://127.0.0.1/bookshelf", null],
      ["https://ebookjapan.yahoo.co.jp:8443/bookshelf/?page=2", null],
      ["not a url", null],
      ["https://ebookjapan.yahoo.co.jp/bookshelf/?page=2", "https://ebookjapan.yahoo.co.jp/bookshelf/?page=2"],
      [null, null],
    ];
    for (const [next, expected] of cases) {
      assert.equal(safeNextPageUrl(next, READY_URL), expected, `next=${next}`);
    }
  });

  it("fails loudly when a reader exceeds the bounded batch size", () => {
    const oversized = Array.from({ length: LIBRARY_BATCH_MAX + 1 }, (_, i) => ({
      cid: `C${i}`,
      title: "t",
      state: "unknown" as const,
    }));
    const unregister = registerLibraryPageReader(
      makeReader({ readPage: () => readyReply(oversized, null) }),
    );
    const reply = handleLibraryReadPage("ebookjapan", {}, READY_URL);
    assert.deepEqual(reply, { ok: false, error: "library_batch_too_large" });
    unregister();
  });

  it("passes transient and login classifications through untouched", () => {
    const unregister = registerLibraryPageReader(
      makeReader({ readPage: () => ({ ok: true, state: "page_not_ready", pageUrl: READY_URL }) }),
    );
    assert.deepEqual(handleLibraryReadPage("ebookjapan", {}, READY_URL), {
      ok: true,
      state: "page_not_ready",
      pageUrl: READY_URL,
    });
    unregister();
    const unregister2 = registerLibraryPageReader(
      makeReader({ readPage: () => ({ ok: false, error: "reader_error" }) }),
    );
    assert.deepEqual(handleLibraryReadPage("ebookjapan", {}, READY_URL), {
      ok: false,
      error: "reader_error",
    });
    unregister2();
  });
});
