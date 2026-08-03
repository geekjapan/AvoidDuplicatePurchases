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
});
