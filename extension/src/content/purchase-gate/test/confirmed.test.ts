import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hasConfirmedDuplicate, isConfirmedDuplicate } from "../confirmed.js";

describe("confirmed duplicate classification", () => {
  it("treats owned and other as confirmed; possible and empty as not", () => {
    assert.equal(isConfirmedDuplicate({ owned: true, other: [] }), true);
    assert.equal(
      isConfirmedDuplicate({
        owned: false,
        other: [
          {
            source: "dlsite",
            cid: "RJ1",
            title: "t",
            url: "https://www.dlsite.com/maniax/work/=/product_id/RJ1.html",
          },
        ],
      }),
      true,
    );
    assert.equal(
      isConfirmedDuplicate({
        owned: false,
        other: [],
        possible: [
          {
            source: "fanza_doujin",
            cid: "d_1",
            title: "t",
            url: "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_1/",
          },
        ],
      }),
      false,
    );
    assert.equal(isConfirmedDuplicate({ owned: false, other: [] }), false);
    assert.equal(isConfirmedDuplicate(null), false);
    assert.equal(isConfirmedDuplicate(undefined), false);
  });

  it("hasConfirmedDuplicate scans a hit list", () => {
    assert.equal(
      hasConfirmedDuplicate([
        { owned: false, other: [] },
        { owned: true, other: [] },
      ]),
      true,
    );
    assert.equal(
      hasConfirmedDuplicate([
        {
          owned: false,
          other: [],
          possible: [
            {
              source: "dlsite",
              cid: "RJ1",
              title: "t",
              url: "https://www.dlsite.com/maniax/work/=/product_id/RJ1.html",
            },
          ],
        },
      ]),
      false,
    );
    assert.equal(hasConfirmedDuplicate(null), false);
  });
});
