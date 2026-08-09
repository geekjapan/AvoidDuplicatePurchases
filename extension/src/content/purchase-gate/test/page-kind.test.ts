import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isCartInterventionPage } from "../../cart/page-kind.js";
import { isPurchaseProgressPage } from "../page-kind.js";

describe("purchase progress page classification", () => {
  it("does not classify exact cart pages as purchase progress", () => {
    assert.equal(isPurchaseProgressPage("dlsite", "/maniax/cart"), false);
    assert.equal(isPurchaseProgressPage("dlsite", "/maniax/cart/"), false);
    assert.equal(isPurchaseProgressPage("fanza_doujin", "/dc/doujin/-/basket"), false);
    assert.equal(isPurchaseProgressPage("fanza_books", "/basket"), false);
    assert.equal(isCartInterventionPage("dlsite", "/maniax/cart"), true);
  });

  it("classifies cart children and order/payment paths as progress", () => {
    assert.equal(isPurchaseProgressPage("dlsite", "/maniax/cart/checkout"), true);
    assert.equal(isPurchaseProgressPage("dlsite", "/maniax/order"), true);
    assert.equal(isPurchaseProgressPage("dlsite", "/maniax/payment/card"), true);
    assert.equal(
      isPurchaseProgressPage("fanza_doujin", "/dc/doujin/-/basket/checkout"),
      true,
    );
    assert.equal(isPurchaseProgressPage("fanza_books", "/basket/checkout"), true);
    assert.equal(isPurchaseProgressPage("fanza_books", "/checkout"), true);
  });

  it("excludes ajax/api and post-payment complete paths", () => {
    assert.equal(
      isPurchaseProgressPage("dlsite", "/maniax/cart/ajax/=/mode/other"),
      false,
    );
    assert.equal(
      isPurchaseProgressPage("fanza_doujin", "/dc/doujin/api/baskets/"),
      false,
    );
    assert.equal(isPurchaseProgressPage("dlsite", "/maniax/order/thanks"), false);
    assert.equal(isPurchaseProgressPage("fanza_books", "/checkout/complete"), false);
  });

  it("does not match lookalike history paths without a segment boundary", () => {
    for (const pathname of [
      "/maniax/order-history",
      "/maniax/payment-history",
      "/maniax/purchase-history",
      "/maniax/checkout-history",
    ]) {
      assert.equal(isPurchaseProgressPage("dlsite", pathname), false, pathname);
    }
    for (const pathname of [
      "/dc/doujin/-/order-history",
      "/dc/doujin/-/payment-history",
      "/dc/doujin/-/purchase-history",
      "/dc/doujin/-/checkout-history",
    ]) {
      assert.equal(isPurchaseProgressPage("fanza_doujin", pathname), false, pathname);
    }
    for (const pathname of [
      "/basket-history",
      "/order-history",
      "/payment-history",
      "/purchase-history",
      "/checkout-history",
    ]) {
      assert.equal(isPurchaseProgressPage("fanza_books", pathname), false, pathname);
    }
  });
});
