import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyDisplayPage } from "../page-kind.js";

describe("T-DISPLAY page classification (three stores)", () => {
  it("classifies verified product pages for all three stores", () => {
    assert.equal(
      classifyDisplayPage("dlsite", "/maniax/work/=/product_id/RJ123456.html"),
      "product",
    );
    assert.equal(
      classifyDisplayPage("fanza_doujin", "/dc/doujin/-/detail/=/cid=d_900001/"),
      "product",
    );
    assert.equal(
      classifyDisplayPage("fanza_books", "/product/100001/b100xxxxx01001/"),
      "product",
    );
  });

  it("classifies verified listing pages for all three stores", () => {
    assert.equal(classifyDisplayPage("dlsite", "/maniax/=/keyword/=/"), "listing");
    assert.equal(classifyDisplayPage("dlsite", "/maniax/fsr/=/language/jp/"), "listing");
    assert.equal(
      classifyDisplayPage("fanza_doujin", "/dc/doujin/-/list/=/"),
      "listing",
    );
    assert.equal(classifyDisplayPage("fanza_books", "/list/"), "listing");
  });

  it("does not intervene on cart/basket pages (T-CART owns cart)", () => {
    assert.equal(classifyDisplayPage("dlsite", "/maniax/cart"), "none");
    assert.equal(classifyDisplayPage("dlsite", "/maniax/cart/"), "none");
    assert.equal(
      classifyDisplayPage("fanza_doujin", "/dc/doujin/-/basket/"),
      "none",
    );
    assert.equal(classifyDisplayPage("fanza_books", "/basket/"), "none");
  });

  it("does not intervene on library/history pages", () => {
    assert.equal(
      classifyDisplayPage(
        "dlsite",
        "/maniax/mypage/userbuy/=/type/all/start/all/sort/1/order/1/page/1",
      ),
      "none",
    );
    assert.equal(
      classifyDisplayPage("fanza_doujin", "/dc/doujin/-/mylibrary/"),
      "none",
    );
    assert.equal(classifyDisplayPage("fanza_books", "/library/"), "none");
    assert.equal(classifyDisplayPage("fanza_books", "/history/"), "none");
  });

  it("does not intervene on unrecognized pages for all three stores", () => {
    assert.equal(classifyDisplayPage("dlsite", "/maniax/"), "none");
    assert.equal(classifyDisplayPage("dlsite", "/maniax/guide"), "none");
    assert.equal(classifyDisplayPage("fanza_doujin", "/dc/doujin/"), "none");
    assert.equal(
      classifyDisplayPage("fanza_doujin", "/dc/doujin/-/help/"),
      "none",
    );
    assert.equal(classifyDisplayPage("fanza_books", "/"), "none");
    assert.equal(classifyDisplayPage("fanza_books", "/top/"), "none");
  });
});
