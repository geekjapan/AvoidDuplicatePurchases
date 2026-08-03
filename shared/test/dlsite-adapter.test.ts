import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseDlsiteSalesPayload,
  parseDlsiteProductJson,
  mergeProductInfo,
  maxSalesCursor,
  dlsiteProductUrl,
  isValidDlsiteWorkno,
  isStrictUtcIsoInstant,
} from "../adapters/dlsite/index.ts";

describe("dlsite adapter", () => {
  it("parses sales payload and merges product metadata", () => {
    const sales = parseDlsiteSalesPayload([
      { workno: "rj000001", sales_date: "2022-06-11T14:20:07.000000Z" },
    ]);
    assert.equal(sales.length, 1);
    const listing = mergeProductInfo(sales[0]!, {
      work_name: "作品",
      maker_name: "メーカー",
    });
    assert.equal(listing.cid, "RJ000001");
    assert.equal(listing.title, "作品");
    assert.equal(listing.maker, "メーカー");
    assert.equal(maxSalesCursor(sales), "2022-06-11T14:20:07.000000Z");
  });

  it("builds product URLs and validates worknos", () => {
    assert.ok(isValidDlsiteWorkno("RJ123456"));
    assert.match(dlsiteProductUrl("RJ123456"), /product_id\/RJ123456/);
    assert.match(dlsiteProductUrl("VJ123456"), /\/pro\//);
    assert.match(dlsiteProductUrl("BJ123456"), /\/books\//);
  });

  it("accepts strict UTC ISO instants including fractional seconds", () => {
    assert.equal(isStrictUtcIsoInstant("2022-06-11T14:20:07.000000Z"), true);
    assert.equal(isStrictUtcIsoInstant("2024-01-01T00:00:00Z"), true);
    assert.equal(isStrictUtcIsoInstant("2024-02-29T12:34:56.123Z"), true);
    const sales = parseDlsiteSalesPayload([
      { workno: "RJ000001", sales_date: "2024-01-01T00:00:00.000Z" },
      { workno: "RJ000002", sales_date: "2024-02-29T23:59:59Z" },
    ]);
    assert.equal(sales.length, 2);
  });

  it("rejects impossible calendar, locale, and timezone sales_date variants (atomic batch)", () => {
    const invalidDates = [
      "2024-02-30T00:00:00Z",
      "2024-04-31T00:00:00Z",
      "01/02/2024",
      "2024-01-01T00:00:00+09:00",
      "2024-01-01T00:00:00+00:00",
      "2024-01-01 00:00:00Z",
      "not-a-date",
    ];
    for (const sales_date of invalidDates) {
      assert.equal(isStrictUtcIsoInstant(sales_date), false, sales_date);
      assert.throws(
        () => parseDlsiteSalesPayload([{ workno: "RJ000001", sales_date }]),
        /schema validation|failed/,
        sales_date,
      );
    }

    // Malformed row rejects the entire batch, including valid siblings.
    assert.throws(
      () =>
        parseDlsiteSalesPayload([
          { workno: "RJ000001", sales_date: "2022-06-11T14:20:07.000000Z" },
          { workno: "RJ000002", sales_date: "2024-02-30T00:00:00Z" },
        ]),
      /schema validation|failed/,
    );
    assert.throws(
      () =>
        parseDlsiteSalesPayload([
          { workno: "RJ000001", sales_date: "2022-06-11T14:20:07.000000Z" },
          { workno: "RJ000002", sales_date: "01/02/2024" },
        ]),
      /schema validation|failed/,
    );
  });

  it("rejects the complete batch when any row is malformed (zod strict)", () => {
    assert.throws(
      () =>
        parseDlsiteSalesPayload([
          { workno: "RJ000001", sales_date: "2022-06-11T14:20:07.000000Z" },
          { workno: "RJ000002", sales_date: "not-a-date" },
        ]),
      /schema validation|failed/,
    );
    assert.throws(
      () =>
        parseDlsiteSalesPayload([
          { workno: "NOT-A-WORKNO", sales_date: "2022-06-11T14:20:07.000000Z" },
        ]),
      /schema validation|failed/,
    );
    assert.throws(() => parseDlsiteSalesPayload([{ workno: "RJ000001" }]), /schema validation|failed/);
  });

  it("accepts items wrapper payloads", () => {
    const sales = parseDlsiteSalesPayload({
      items: [{ workno: "RJ000003", sales_date: "2023-01-01T00:00:00.000Z" }],
    });
    assert.equal(sales.length, 1);
    assert.equal(sales[0]!.workno, "RJ000003");
  });

  it("parses product.json via Zod and returns null for invalid shapes", () => {
    const ok = parseDlsiteProductJson([
      {
        workno: "rj000001",
        work_name: " 作品 ",
        maker_name: "メーカー",
        series_id: null,
        image_url: "https://example.com/a.jpg",
      },
    ]);
    assert.deepEqual(ok, {
      workno: "RJ000001",
      work_name: "作品",
      maker_name: "メーカー",
      series_id: null,
      image_url: "https://example.com/a.jpg",
    });

    assert.equal(parseDlsiteProductJson(null), null);
    assert.equal(parseDlsiteProductJson([]), null);
    assert.equal(parseDlsiteProductJson([{ workno: "RJ000001" }]), null);
    assert.equal(
      parseDlsiteProductJson([{ workno: "BAD", work_name: "x" }]),
      null,
    );
  });
});
