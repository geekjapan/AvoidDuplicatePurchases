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
  productUrlForSource,
  fanzaDoujinProductUrl,
  fanzaBooksProductUrl,
  fanzaVideoProductUrl,
  fanzaDlsoftProductUrl,
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

  it("maxSalesCursor uses instant comparison for mixed ISO fractional precision", () => {
    // Lexical max wrongly picks seconds-only Z because 'Z' > '.'; chronological max is .999Z.
    const mixed = parseDlsiteSalesPayload([
      { workno: "RJ000001", sales_date: "2024-01-01T00:00:00Z" },
      { workno: "RJ000002", sales_date: "2024-01-01T00:00:00.999Z" },
    ]);
    assert.equal(maxSalesCursor(mixed), "2024-01-01T00:00:00.999Z");
    assert.equal(maxSalesCursor([...mixed].reverse()), "2024-01-01T00:00:00.999Z");

    // Probe order: seconds-only first then fractional (completion-verifier failure case).
    assert.equal(
      maxSalesCursor([
        { workno: "RJ000010", sales_date: "2024-01-01T00:00:00Z" },
        { workno: "RJ000011", sales_date: "2024-01-01T00:00:00.999Z" },
      ]),
      "2024-01-01T00:00:00.999Z",
    );
  });

  it("maxSalesCursor orders sub-millisecond six-digit fractions exactly (no Date.parse truncation)", () => {
    // Date.parse maps both to the same ms; exact compare must pick .000002Z either order.
    const a = "2024-01-01T00:00:00.000001Z";
    const b = "2024-01-01T00:00:00.000002Z";
    assert.equal(isStrictUtcIsoInstant(a), true);
    assert.equal(isStrictUtcIsoInstant(b), true);
    assert.equal(
      maxSalesCursor([
        { workno: "RJ000001", sales_date: a },
        { workno: "RJ000002", sales_date: b },
      ]),
      b,
    );
    assert.equal(
      maxSalesCursor([
        { workno: "RJ000002", sales_date: b },
        { workno: "RJ000001", sales_date: a },
      ]),
      b,
    );

    // Cross-second: later second wins regardless of large earlier fraction.
    assert.equal(
      maxSalesCursor([
        { workno: "RJ000003", sales_date: "2024-01-01T00:00:00.999999Z" },
        { workno: "RJ000004", sales_date: "2024-01-01T00:00:01Z" },
      ]),
      "2024-01-01T00:00:01Z",
    );
    assert.equal(
      maxSalesCursor([
        { workno: "RJ000004", sales_date: "2024-01-01T00:00:01Z" },
        { workno: "RJ000003", sales_date: "2024-01-01T00:00:00.999999Z" },
      ]),
      "2024-01-01T00:00:01Z",
    );

    // Mathematically equal fractions: deterministic raw-string winner, both orders.
    const eq1 = "2024-01-01T00:00:00.1Z";
    const eq2 = "2024-01-01T00:00:00.100Z";
    const eqWinner = eq1 < eq2 ? eq2 : eq1; // raw-string max (lexicographic of originals after equal instants)
    // compareUtcIsoInstants tie-break: if a < b lexically return -1 so max prefers larger raw string
    const forward = maxSalesCursor([
      { workno: "RJ000005", sales_date: eq1 },
      { workno: "RJ000006", sales_date: eq2 },
    ]);
    const reverse = maxSalesCursor([
      { workno: "RJ000006", sales_date: eq2 },
      { workno: "RJ000005", sales_date: eq1 },
    ]);
    assert.equal(forward, reverse);
    assert.equal(forward, eqWinner);
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
    assert.equal(ok?.workno, "RJ000001");
    assert.equal(ok?.work_name, "作品");
    assert.equal(ok?.maker_name, "メーカー");
    assert.equal(ok?.series_id, null);
    assert.equal(ok?.image_url, "https://example.com/a.jpg");
    assert.ok(ok?.raw);

    assert.equal(parseDlsiteProductJson(null), null);
    assert.equal(parseDlsiteProductJson([]), null);
    assert.equal(parseDlsiteProductJson([{ workno: "RJ000001" }]), null);
    assert.equal(
      parseDlsiteProductJson([{ workno: "BAD", work_name: "x" }]),
      null,
    );
  });

  it("preserves untouched sale/product evidence including unknown product fields in raw_json", () => {
    const sales = parseDlsiteSalesPayload([
      {
        workno: "RJ000001",
        sales_date: "2022-06-11T14:20:07.000000Z",
        future_sale_field: "keep-me",
      },
    ]);
    assert.equal(sales[0]!.raw?.future_sale_field, "keep-me");

    const product = parseDlsiteProductJson([
      {
        workno: "RJ000001",
        work_name: "作品A",
        maker_name: "メーカーA",
        series_id: null,
        image_url: null,
        work_pack_parent: "RJ000099",
        unknown_future_field: { nested: true },
      },
    ]);
    assert.ok(product);
    assert.equal(product!.raw?.work_pack_parent, "RJ000099");
    assert.deepEqual(product!.raw?.unknown_future_field, { nested: true });

    const listing = mergeProductInfo(sales[0]!, product);
    const raw = JSON.parse(listing.rawJson) as {
      sale: Record<string, unknown>;
      product: Record<string, unknown>;
    };
    assert.equal(raw.sale.future_sale_field, "keep-me");
    assert.equal(raw.product.work_pack_parent, "RJ000099");
    assert.deepEqual(raw.product.unknown_future_field, { nested: true });
    assert.equal(raw.product.work_name, "作品A");
  });

  it("builds source-specific product URLs for every declared listing source", () => {
    assert.match(productUrlForSource("dlsite", "RJ123456"), /product_id\/RJ123456/);
    assert.equal(
      productUrlForSource("fanza_doujin", "d_285449"),
      fanzaDoujinProductUrl("d_285449"),
    );
    assert.equal(
      fanzaDoujinProductUrl("d_285449"),
      "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_285449/",
    );
    assert.equal(
      fanzaBooksProductUrl("b100xxxxx01001", "100001"),
      "https://book.dmm.co.jp/product/100001/b100xxxxx01001/",
    );
    assert.equal(
      productUrlForSource("fanza_books", "b100xxxxx01001", { seriesId: "100001" }),
      "https://book.dmm.co.jp/product/100001/b100xxxxx01001/",
    );
    assert.equal(fanzaBooksProductUrl("b100xxxxx01001", null), null);
    assert.equal(
      productUrlForSource("fanza_video", "abcd00123"),
      fanzaVideoProductUrl("abcd00123"),
    );
    assert.match(productUrlForSource("fanza_video", "abcd00123"), /cid=abcd00123/);
    assert.equal(
      productUrlForSource("fanza_dlsoft", "brand_0001"),
      fanzaDlsoftProductUrl("brand_0001"),
    );
    assert.match(productUrlForSource("fanza_dlsoft", "brand_0001"), /dlsoft\.dmm\.co\.jp/);

    for (const source of [
      "dlsite",
      "fanza_doujin",
      "fanza_books",
      "fanza_video",
      "fanza_dlsoft",
    ] as const) {
      const url = productUrlForSource(source, "x", { seriesId: "1" });
      assert.doesNotMatch(url, /example\.invalid/);
    }
  });
});
