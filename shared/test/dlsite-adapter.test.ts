import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseDlsiteSalesPayload,
  mergeProductInfo,
  maxSalesCursor,
  dlsiteProductUrl,
  isValidDlsiteWorkno,
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
  });
});
