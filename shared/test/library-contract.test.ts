import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LIBRARY_ITEM_STATES,
  LIBRARY_SOURCES,
  LIBRARY_SYNC_PROVIDERS,
  SOURCES,
  librarySyncProvider,
} from "../src/index.js";
import {
  LibraryImportItemSchema,
  LibraryImportRequestSchema,
  LibraryImportResponseSchema,
  LibrarySourceSchema,
  SourceSchema,
} from "../src/index.js";

/** Synthetic identity only — must not collide with real service CIDs/URLs. */
const VALID_ITEM = {
  cid: "A00SYNTH01",
  title: "合成タイトル",
  state: "unknown",
};

describe("library-sync sources", () => {
  it("extends SourceSchema with the three DOM library sources", () => {
    assert.ok(SOURCES.includes("amazon"));
    assert.ok(SOURCES.includes("ebookjapan"));
    assert.ok(SOURCES.includes("kobo"));
    for (const source of ["amazon", "ebookjapan", "kobo"]) {
      assert.equal(SourceSchema.parse(source), source);
      assert.equal(LibrarySourceSchema.parse(source), source);
    }
    // The library protocol is disjoint from the adapter-based legacy sources.
    for (const source of ["dlsite", "fanza_doujin", "fanza_books", "fanza_video", "fanza_dlsoft"]) {
      assert.ok(!(LIBRARY_SOURCES as readonly string[]).includes(source));
      assert.throws(() => LibrarySourceSchema.parse(source));
    }
    for (const source of LIBRARY_SOURCES) {
      assert.ok((SOURCES as readonly string[]).includes(source));
    }
  });

  it("registers one start URL per provider (absolute https)", () => {
    assert.equal(LIBRARY_SYNC_PROVIDERS.length, LIBRARY_SOURCES.length);
    for (const provider of LIBRARY_SYNC_PROVIDERS) {
      assert.ok((LIBRARY_SOURCES as readonly string[]).includes(provider.source));
      const url = new URL(provider.startUrl);
      assert.equal(url.protocol, "https:");
      assert.equal(url.username, "");
      assert.equal(url.password, "");
      assert.equal(librarySyncProvider(provider.source), provider);
    }
    assert.equal(librarySyncProvider("dlsite"), null);
  });
});

describe("library import schemas", () => {
  it("parses a bounded batch with every explicit state", () => {
    for (const state of LIBRARY_ITEM_STATES) {
      const parsed = LibraryImportRequestSchema.parse({
        source: "amazon",
        pageUrl: "https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll/",
        items: [{ ...VALID_ITEM, state }],
      });
      assert.equal(parsed.items[0]?.state, state);
    }
  });

  it("preserves optional identity fields verbatim", () => {
    const parsed = LibraryImportItemSchema.parse({
      ...VALID_ITEM,
      maker: "合成サークル",
      seriesId: "S1",
      imageUrl: "https://example.com/cover.jpg",
      productUrl: "https://ebookjapan.yahoo.co.jp/books/900001/A00SYNTH01/",
    });
    assert.equal(parsed.maker, "合成サークル");
    assert.equal(parsed.seriesId, "S1");
  });

  it("rejects empty identity, unknown states, and non-library sources", () => {
    assert.throws(() => LibraryImportItemSchema.parse({ ...VALID_ITEM, cid: "" }));
    assert.throws(() => LibraryImportItemSchema.parse({ ...VALID_ITEM, title: "  " }));
    assert.throws(() => LibraryImportItemSchema.parse({ ...VALID_ITEM, state: "owned" }));
    assert.throws(() =>
      LibraryImportRequestSchema.parse({
        source: "dlsite",
        pageUrl: "https://www.dlsite.com/",
        items: [VALID_ITEM],
      }),
    );
  });

  it("keeps price fields out of the contract (strict schema)", () => {
    assert.throws(() =>
      LibraryImportItemSchema.parse({
        ...VALID_ITEM,
        currentPrice: { amountMinor: 100, currency: "JPY", taxStatus: "included" },
      }),
    );
  });

  it("requires an absolute https page URL and a bounded batch", () => {
    const base = {
      source: "kobo",
      items: [VALID_ITEM],
    };
    assert.throws(() =>
      LibraryImportRequestSchema.parse({ ...base, pageUrl: "http://books.rakuten.co.jp/" }),
    );
    assert.throws(() =>
      LibraryImportRequestSchema.parse({
        ...base,
        pageUrl: "https://user@books.rakuten.co.jp/",
      }),
    );
    assert.throws(() => LibraryImportRequestSchema.parse({ ...base, items: [] }));
    assert.throws(() =>
      LibraryImportRequestSchema.parse({
        ...base,
        pageUrl: "https://books.rakuten.co.jp/e-book/",
        items: Array.from({ length: 101 }, (_, i) => ({ ...VALID_ITEM, cid: `CID${i}` })),
      }),
    );
  });

  it("parses the import response with full per-state counts", () => {
    const byState: Record<string, number> = {};
    for (const state of LIBRARY_ITEM_STATES) byState[state] = 0;
    byState.purchased = 1;
    byState.unknown = 2;
    const res = LibraryImportResponseSchema.parse({
      observed: 3,
      inserted: 1,
      updated: 2,
      byState,
    });
    assert.equal(res.inserted + res.updated, res.observed);
    assert.throws(() =>
      LibraryImportResponseSchema.parse({
        observed: 1,
        inserted: 1,
        updated: 0,
        byState: { purchased: -1 },
      }),
    );
    // Missing required state keys fail closed (server always emits every key).
    assert.throws(() =>
      LibraryImportResponseSchema.parse({
        observed: 1,
        inserted: 1,
        updated: 0,
        byState: { purchased: 1 },
      }),
    );
    // Unknown state keys fail closed.
    assert.throws(() =>
      LibraryImportResponseSchema.parse({
        observed: 1,
        inserted: 1,
        updated: 0,
        byState: { ...byState, owned: 1 },
      }),
    );
    // Unknown response keys fail closed.
    assert.throws(() =>
      LibraryImportResponseSchema.parse({
        observed: 1,
        inserted: 1,
        updated: 0,
        byState,
        extra: 1,
      }),
    );
  });
});
