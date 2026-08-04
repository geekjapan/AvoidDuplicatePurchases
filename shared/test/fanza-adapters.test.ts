import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  parseJpDateKey,
  parseDoujinMylibrariesPayload,
  doujinLibraryUrl,
  DOUJIN_LIMIT_MAX,
} from "../adapters/fanza_doujin/index.ts";
import {
  parseBooksImportPayload,
  parseBooksLibraryPayload,
  booksLibraryUrl,
} from "../adapters/fanza_books/index.ts";
import { parseVideoGraphqlPayload } from "../adapters/fanza_video/index.ts";
import { parseDlsoftLibraryPayload } from "../adapters/fanza_dlsoft/index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

describe("fanza_doujin adapter", () => {
  it("parses Japanese date keys and day-precision listings", () => {
    assert.equal(parseJpDateKey("2026年07月24日"), "2026-07-24");
    assert.equal(parseJpDateKey("2026/07/24"), null);

    const raw = JSON.parse(readFileSync(join(FIXTURES, "fanza-doujin-page.json"), "utf8"));
    const listings = parseDoujinMylibrariesPayload(raw);
    assert.equal(listings.length, 2);
    assert.equal(listings[0]!.cid, "d_100001");
    assert.equal(listings[0]!.purchasedAt, "2026-07-24");
    assert.equal(listings[0]!.purchasedAtPrecision, "day");
    assert.equal(listings[1]!.purchasedAt, null);
    assert.ok(doujinLibraryUrl(1, 200).includes(`limit=${DOUJIN_LIMIT_MAX}`));
  });

  it("accepts valid leap days and rejects impossible calendar dates", () => {
    assert.equal(parseJpDateKey("2024年02月29日"), "2024-02-29");
    assert.equal(parseJpDateKey("2000年02月29日"), "2000-02-29");
    assert.equal(parseJpDateKey("2023年02月29日"), null);
    assert.equal(parseJpDateKey("2026年02月30日"), null);
    assert.equal(parseJpDateKey("2026年04月31日"), null);
    assert.equal(parseJpDateKey("2026年13月01日"), null);
    assert.equal(parseJpDateKey("2026年00月01日"), null);
    assert.equal(parseJpDateKey("2026年01月00日"), null);
  });

  it("preserves unknown nested source evidence", () => {
    const listings = parseDoujinMylibrariesPayload({
      error_code: 0,
      data: {
        items: {
          "2026年01月01日": [{
            contentId: "d_unknown",
            title: "synthetic",
            sourceOnly: { nested: ["untouched"] },
          }],
        },
      },
    });
    assert.deepEqual(JSON.parse(listings[0]!.rawJson).sale.sourceOnly, {
      nested: ["untouched"],
    });
  });

  it("rejects source errors and whitespace-only listing identity", () => {
    assert.throws(() =>
      parseDoujinMylibrariesPayload({ error_code: 1, data: { items: {} } }),
    );
    assert.throws(() =>
      parseDoujinMylibrariesPayload({
        error_code: 0,
        data: { items: { "2026年01月01日": [{ contentId: "   ", title: "synthetic" }] } },
      }),
    );
  });
});

describe("fanza_books adapter", () => {
  it("uses shop_name=all for library and second-precision purchased_at", () => {
    assert.ok(booksLibraryUrl(1).includes("shop_name=all"));

    const library = parseBooksLibraryPayload({
      series_books: [{ series_id: "100001", author: "黒斗" }],
      pager: { page: 1, per_page: 20, total_count: 1 },
    });
    assert.equal(library[0]!.seriesId, "100001");

    const raw = JSON.parse(readFileSync(join(FIXTURES, "fanza-books-import.json"), "utf8"));
    const listings = parseBooksImportPayload(raw);
    assert.equal(listings.length, 1);
    assert.equal(listings[0]!.purchasedAtPrecision, "second");
    assert.equal(listings[0]!.seriesId, "100001");
    assert.equal(listings[0]!.purchasedAt, "2023-12-30T12:00:00+09:00");

    assert.equal(
      parseBooksImportPayload({
        seriesId: "synthetic-series",
        payload: {
          volume_books: [{
            content_id: "synthetic-date",
            title: "synthetic",
            purchased: { purchased_date: "2024-02-29T12:00:00+09:00" },
          }],
        },
      })[0]!.purchasedAt,
      "2024-02-29T12:00:00+09:00",
    );
    assert.throws(() =>
      parseBooksImportPayload({
        seriesId: "synthetic-series",
        payload: {
          volume_books: [{
            content_id: "synthetic-date",
            title: "synthetic",
            purchased: { purchased_date: "2023-02-29T12:00:00+09:00" },
          }],
        },
      }),
    );
    assert.throws(() =>
      parseBooksImportPayload({
        seriesId: "synthetic-series",
        payload: {
          volume_books: [{
            content_id: "synthetic-date",
            title: "synthetic",
            purchased: { purchased_date: "not-an-iso-date" },
          }],
        },
      }),
    );
  });

  it("rejects source errors and whitespace-only content identity", () => {
    assert.throws(() => parseBooksLibraryPayload({ error: "synthetic_error" }));
    assert.throws(() =>
      parseBooksImportPayload({
        seriesId: "synthetic-series",
        payload: {
          volume_books: [
            {
              content_id: "synthetic-book",
              title: "   ",
              purchased: { purchased_date: "2026-01-01T00:00:00Z" },
            },
          ],
        },
      }),
    );
  });

  it("preserves untouched series-level raw fields alongside volume evidence", () => {
    const library = parseBooksLibraryPayload({
      series_books: [{
        series_id: "synthetic-series-raw",
        author: "synthetic-author",
        unknownSeriesField: { nested: ["keep-series"] },
        redactedMetadata: { shop: "all", tag: "synthetic" },
      }],
      pager: { page: 1, per_page: 20, total_count: 1 },
    });
    assert.equal(library[0]!.seriesId, "synthetic-series-raw");
    assert.deepEqual(library[0]!.seriesRaw.unknownSeriesField, { nested: ["keep-series"] });
    assert.deepEqual(library[0]!.seriesRaw.redactedMetadata, {
      shop: "all",
      tag: "synthetic",
    });

    const listings = parseBooksImportPayload({
      seriesId: library[0]!.seriesId,
      author: library[0]!.author,
      seriesRaw: library[0]!.seriesRaw,
      payload: {
        volume_books: [{
          content_id: "synthetic-volume-raw",
          title: "synthetic volume",
          unknownVolumeField: { nested: true },
          purchased: { purchased_date: "2026-01-01T00:00:00Z" },
        }],
      },
    });
    const sale = JSON.parse(listings[0]!.rawJson).sale as Record<string, unknown>;
    assert.deepEqual(sale.unknownVolumeField, { nested: true });
    assert.deepEqual((sale.series as Record<string, unknown>).unknownSeriesField, {
      nested: ["keep-series"],
    });
    assert.deepEqual((sale.series as Record<string, unknown>).redactedMetadata, {
      shop: "all",
      tag: "synthetic",
    });
  });
});

describe("fanza_video adapter", () => {
  it("keeps viewing timestamp in raw evidence only", () => {
    const raw = JSON.parse(readFileSync(join(FIXTURES, "fanza-video-page.json"), "utf8"));
    const listings = parseVideoGraphqlPayload(raw);
    assert.equal(listings.length, 1);
    assert.equal(listings[0]!.purchasedAt, null);
    assert.equal(listings[0]!.purchasedAtPrecision, "unknown");
    const evidence = JSON.parse(listings[0]!.rawJson);
    assert.equal(evidence.sale.latestViewingRightsAcquiredAt, "2025-09-23T00:00:00Z");
  });

  it("preserves unknown top-level and nested source evidence", () => {
    const listings = parseVideoGraphqlPayload({
      data: {
        user: {
          ppvLibrary: {
            contentViewingRightsSummaryList: {
              pageInfo: { hasNext: false },
              items: [{
                id: "synthetic-video-raw",
                unknownTopLevel: { nested: true },
                content: {
                  id: "synthetic-video-raw",
                  title: "synthetic",
                  unknownContent: { value: 1 },
                },
                contentItem: {
                  latestViewingRightsAcquiredAt: null,
                  unknownContentItem: ["keep"],
                },
              }],
            },
          },
        },
      },
    });
    const sale = JSON.parse(listings[0]!.rawJson).sale;
    assert.deepEqual(sale.unknownTopLevel, { nested: true });
    assert.deepEqual(sale.content.unknownContent, { value: 1 });
    assert.deepEqual(sale.contentItem.unknownContentItem, ["keep"]);
  });

  it("rejects GraphQL errors and whitespace-only content identity", () => {
    assert.throws(() => parseVideoGraphqlPayload({ errors: [{ message: "synthetic" }] }));
    assert.throws(() =>
      parseVideoGraphqlPayload({
        data: {
          user: {
            ppvLibrary: {
              contentViewingRightsSummaryList: {
                pageInfo: { hasNext: false },
                items: [{ content: { id: "synthetic-video", title: "   " } }],
              },
            },
          },
        },
      }),
    );
  });
});

describe("fanza_dlsoft adapter", () => {
  it("parses library without purchase date", () => {
    const raw = JSON.parse(readFileSync(join(FIXTURES, "fanza-dlsoft-page.json"), "utf8"));
    const listings = parseDlsoftLibraryPayload(raw);
    assert.equal(listings.length, 1);
    assert.equal(listings[0]!.cid, "brand_0001");
    assert.equal(listings[0]!.purchasedAt, null);
    assert.equal(listings[0]!.purchasedAtPrecision, "unknown");
    assert.equal(listings[0]!.maker, "メーカーZ");
  });

  it("rejects source errors and whitespace-only listing identity", () => {
    assert.throws(() =>
      parseDlsoftLibraryPayload({
        error: { message: "synthetic" },
        body: { totalCount: 0, library: [] },
      }),
    );
    assert.throws(() =>
      parseDlsoftLibraryPayload({
        error: null,
        body: { totalCount: 1, library: [{ contentId: "   ", title: "synthetic" }] },
      }),
    );
  });
});
