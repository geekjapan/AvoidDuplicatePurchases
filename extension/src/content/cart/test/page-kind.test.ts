import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isCartInterventionPage } from "../page-kind.js";

describe("cart page classification", () => {
  it("classifies cart pages for all three intervention stores", () => {
    assert.equal(isCartInterventionPage("dlsite", "/maniax/cart"), true);
    assert.equal(isCartInterventionPage("fanza_doujin", "/dc/doujin/-/basket/"), true);
    assert.equal(isCartInterventionPage("fanza_books", "/basket/"), true);
  });

  it("does not classify product or listing pages as cart", () => {
    assert.equal(
      isCartInterventionPage("dlsite", "/maniax/work/=/product_id/RJ123456.html"),
      false,
    );
    assert.equal(
      isCartInterventionPage("fanza_doujin", "/dc/doujin/-/detail/=/cid=d_900001/"),
      false,
    );
    assert.equal(
      isCartInterventionPage("fanza_books", "/product/100001/b100xxxxx01001/"),
      false,
    );
  });
});
