import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isCartPage } from "../page-guard.js";

describe("cart page guard", () => {
  it("allows removal only on exact cart pathnames (trailing slash only)", () => {
    assert.equal(isCartPage("dlsite", "/maniax/cart"), true);
    assert.equal(isCartPage("dlsite", "/maniax/cart/"), true);
    assert.equal(isCartPage("fanza-doujin", "/dc/doujin/-/basket"), true);
    assert.equal(isCartPage("fanza-doujin", "/dc/doujin/-/basket/"), true);
    assert.equal(isCartPage("fanza-books", "/basket"), true);
    assert.equal(isCartPage("fanza-books", "/basket/"), true);
  });

  it("blocks removal outside cart pages", () => {
    assert.equal(isCartPage("dlsite", "/maniax/work/=/product_id/RJ123456.html"), false);
    assert.equal(isCartPage("fanza-doujin", "/dc/doujin/-/detail/=/cid=d_900001/"), false);
    assert.equal(isCartPage("fanza-books", "/product/100001/b100xxxxx01001/"), false);
    assert.equal(isCartPage("dlsite", "/maniax/=/keyword/=/"), false);
  });

  it("treats documented child paths as out-of-cart (delete/undo must not run)", () => {
    // DLsite cart ajax / mode subpaths
    assert.equal(isCartPage("dlsite", "/maniax/cart/ajax/=/mode/other"), false);
    assert.equal(
      isCartPage("dlsite", "/maniax/cart/ajax/=/mode/nothanks/product_id/RJ123456"),
      false,
    );
    // FANZA Doujin checkout / API-ish children
    assert.equal(isCartPage("fanza-doujin", "/dc/doujin/-/basket/checkout"), false);
    assert.equal(isCartPage("fanza-doujin", "/dc/doujin/-/basket/checkout/"), false);
    assert.equal(isCartPage("fanza-doujin", "/dc/doujin/api/baskets/"), false);
    // FANZA Books checkout / children
    assert.equal(isCartPage("fanza-books", "/basket/checkout"), false);
    assert.equal(isCartPage("fanza-books", "/basket/checkout/"), false);
    assert.equal(isCartPage("fanza-books", "/basket/ajax/count"), false);
  });
});
