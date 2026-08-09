import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareTier,
  comparisonSummaryLabel,
  filterComparisonListings,
  groupByWorkId,
  isPriceComparisonSource,
  moneyLabel,
  storeBrandLabel,
  type TierCandidate,
} from "../src/pages/price-comparison.ts";
import type { Listing } from "../src/api.ts";

function listing(
  partial: Partial<Listing> &
    Pick<Listing, "id" | "source" | "cid" | "workId" | "title">,
): Listing {
  return {
    workIdLocked: false,
    maker: null,
    seriesId: null,
    imageUrl: null,
    imageProvenance: null,
    productUrl: null,
    productUrlProvenance: null,
    purchasedAt: null,
    purchasedAtPrecision: "unknown",
    purchasePrice: null,
    currentPrice: null,
    priceObservation: null,
    ...partial,
  };
}

describe("price comparison pure helpers (#59)", () => {
  it("accepts only dlsite / fanza_doujin / fanza_books", () => {
    assert.equal(isPriceComparisonSource("dlsite"), true);
    assert.equal(isPriceComparisonSource("fanza_doujin"), true);
    assert.equal(isPriceComparisonSource("fanza_books"), true);
    assert.equal(isPriceComparisonSource("fanza_video"), false);
    assert.equal(isPriceComparisonSource("fanza_dlsoft"), false);
    assert.equal(isPriceComparisonSource("amazon"), false);
  });

  it("labels FANZA brand while keeping source identity separate", () => {
    assert.equal(storeBrandLabel("dlsite"), "DLsite");
    assert.equal(storeBrandLabel("fanza_doujin"), "FANZA");
    assert.equal(storeBrandLabel("fanza_books"), "FANZA");
  });

  it("filters excluded sources and groups by workId only", () => {
    const rows = [
      listing({
        id: 1,
        source: "dlsite",
        cid: "RJ1",
        workId: 10,
        title: "A",
      }),
      listing({
        id: 2,
        source: "fanza_video",
        cid: "v1",
        workId: 10,
        title: "A-video",
      }),
      listing({
        id: 3,
        source: "fanza_doujin",
        cid: "d1",
        workId: 10,
        title: "A-doujin",
      }),
      listing({
        id: 4,
        source: "fanza_books",
        cid: "b1",
        workId: 20,
        title: "B",
      }),
    ];
    const filtered = filterComparisonListings(rows);
    assert.deepEqual(
      filtered.map((r) => r.source),
      ["dlsite", "fanza_doujin", "fanza_books"],
    );
    const groups = groupByWorkId(filtered);
    assert.equal(groups.get(10)?.length, 2);
    assert.equal(groups.get(20)?.length, 1);
    assert.equal(groups.has(99), false);
  });

  it("renders null tier as 未取得 and never invents amounts", () => {
    assert.equal(moneyLabel(null), "未取得");
    assert.equal(
      moneyLabel({
        amountMinor: 1100,
        currency: "JPY",
        taxStatus: "included",
      }),
      "JPY 1100（税込・最小単位）",
    );
  });

  it("ranks same currency+taxStatus and reports lowest winners", () => {
    const candidates: TierCandidate[] = [
      {
        source: "dlsite",
        cid: "RJ1",
        money: {
          amountMinor: 1100,
          currency: "JPY",
          taxStatus: "included",
        },
      },
      {
        source: "fanza_doujin",
        cid: "d1",
        money: {
          amountMinor: 880,
          currency: "JPY",
          taxStatus: "included",
        },
      },
      {
        source: "fanza_books",
        cid: "b1",
        money: {
          amountMinor: 990,
          currency: "JPY",
          taxStatus: "included",
        },
      },
    ];
    const result = compareTier(candidates);
    assert.equal(result.status, "lowest");
    if (result.status !== "lowest") return;
    assert.equal(result.amountMinor, 880);
    assert.equal(result.currency, "JPY");
    assert.equal(result.taxStatus, "included");
    assert.deepEqual(result.winners, [{ source: "fanza_doujin", cid: "d1" }]);
    assert.match(comparisonSummaryLabel(result), /最安/);
    assert.doesNotMatch(comparisonSummaryLabel(result), /比較不可/);
  });

  it("marks currency or taxStatus mismatch as 比較不可 without ranking", () => {
    const taxMismatch = compareTier([
      {
        source: "dlsite",
        cid: "RJ1",
        money: {
          amountMinor: 800,
          currency: "JPY",
          taxStatus: "included",
        },
      },
      {
        source: "fanza_doujin",
        cid: "d1",
        money: {
          amountMinor: 700,
          currency: "JPY",
          taxStatus: "excluded",
        },
      },
    ]);
    assert.equal(taxMismatch.status, "incomparable");
    assert.match(comparisonSummaryLabel(taxMismatch), /比較不可/);

    const currencyMismatch = compareTier([
      {
        source: "dlsite",
        cid: "RJ1",
        money: {
          amountMinor: 800,
          currency: "JPY",
          taxStatus: "included",
        },
      },
      {
        source: "fanza_books",
        cid: "b1",
        money: {
          amountMinor: 700,
          currency: "USD",
          taxStatus: "included",
        },
      },
    ]);
    assert.equal(currencyMismatch.status, "incomparable");
    assert.match(comparisonSummaryLabel(currencyMismatch), /比較不可/);
  });

  it("does not rank when fewer than two non-null tier values exist", () => {
    const oneValue = compareTier([
      {
        source: "dlsite",
        cid: "RJ1",
        money: {
          amountMinor: 1000,
          currency: "JPY",
          taxStatus: "included",
        },
      },
      { source: "fanza_doujin", cid: "d1", money: null },
    ]);
    assert.equal(oneValue.status, "insufficient");
    assert.match(comparisonSummaryLabel(oneValue), /比較対象不足/);

    const none = compareTier([
      { source: "dlsite", cid: "RJ1", money: null },
      { source: "fanza_doujin", cid: "d1", money: null },
    ]);
    assert.equal(none.status, "insufficient");
  });

  it("treats missing candidates as null tiers independently", () => {
    // sale null on one side must not borrow regular or coupon.
    const result = compareTier([
      {
        source: "dlsite",
        cid: "RJ1",
        money: null, // sale missing
      },
      {
        source: "fanza_doujin",
        cid: "d1",
        money: {
          amountMinor: 500,
          currency: "JPY",
          taxStatus: "included",
        },
      },
    ]);
    assert.equal(result.status, "insufficient");
  });
});
