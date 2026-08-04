import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isCartPage } from "../page-guard.js";

describe("cart page guard", () => {
  it("allows removal only on cart pages for all three stores", () => {
    assert.equal(isCartPage("dlsite", "/maniax/cart"), true);
    assert.equal(isCartPage("dlsite", "/maniax/cart/"), true);
    assert.equal(isCartPage("fanza-doujin", "/dc/doujin/-/basket/"), true);
    assert.equal(isCartPage("fanza-books", "/basket/"), true);
  });

  it("blocks removal outside cart pages", () => {
    assert.equal(isCartPage("dlsite", "/maniax/work/=/product_id/RJ123456.html"), false);
    assert.equal(isCartPage("fanza-doujin", "/dc/doujin/-/detail/=/cid=d_900001/"), false);
    assert.equal(isCartPage("fanza-books", "/product/100001/b100xxxxx01001/"), false);
    assert.equal(isCartPage("dlsite", "/maniax/=/keyword/=/"), false);
  });
});
