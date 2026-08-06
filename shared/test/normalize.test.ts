import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertNormalizationSelfCheck,
  dice,
  key,
  l1,
  l2,
  l3,
  l4,
  l5,
  makerMatchKey,
  stripAllBrackets,
  titleMatchKey,
} from "../src/normalize.js";

describe("normalize", () => {
  it("L1: NFKC and case", () => {
    assert.equal(l1("ＡＢＣ　１２３"), "abc 123");
    assert.equal(l1("ｱｲｳ"), "アイウ");
  });

  it("L2: store markers only", () => {
    assert.equal(l2("ある作品【FANZA限定版】"), "ある作品");
    assert.equal(l2("ある作品【dl版】"), "ある作品");
    assert.equal(l2("ある作品【るう - 電マ編】"), "ある作品【るう - 電マ編】");
    assert.equal(l2("ある作品【無料お試し版】"), "ある作品【無料お試し版】");
    assert.equal(l2("【FANZA限定版】"), "【FANZA限定版】");
  });

  it("self-check passes on the production titleMatchKey/key path", () => {
    assert.notEqual(titleMatchKey("作品【演者A】"), titleMatchKey("作品【演者B】"));
    assert.notEqual(key("作品【演者A】", 5), key("作品【演者B】", 5));
    assert.doesNotThrow(() => assertNormalizationSelfCheck());
  });

  it("mutation: blanket bracket removal collapses distinct titles and would fail self-check", () => {
    const a = "作品【演者A】";
    const b = "作品【演者B】";

    // Rejected helper still collapses identifying brackets (kept only for this guard).
    assert.equal(stripAllBrackets(a), stripAllBrackets(b));

    // Simulate production-path regression: replace L2 with stripAllBrackets.
    const regressedKey = (title: string): string => {
      let t = l1(title);
      t = stripAllBrackets(t);
      t = l5(t);
      t = l3(t);
      t = l4(t);
      return t;
    };
    assert.equal(regressedKey(a), regressedKey(b));

    // A self-check wired to the mutated path must throw.
    assert.throws(() => {
      if (regressedKey(a) === regressedKey(b)) {
        throw new Error(
          "normalization regression: distinct bracket content collapsed on production key path",
        );
      }
    }, /regression/);

    // Current production path remains distinct and the real self-check still passes.
    assert.notEqual(titleMatchKey(a), titleMatchKey(b));
    assert.doesNotThrow(() => assertNormalizationSelfCheck());
  });

  it("L3: symbol removal", () => {
    assert.equal(l3("あ・い、う!!"), "あいう");
  });

  it("L4: kana normalization", () => {
    assert.equal(l4("アイドル"), "あいどる");
    assert.equal(l4("ヴァンパイア"), "うあんぱいあ");
    assert.equal(l4("がっこう"), "がつこう");
  });

  it("L5: volume markers", () => {
    assert.equal(l5("作品名 第3巻"), "作品名");
    assert.equal(l5("作品名 vol.12"), "作品名");
  });

  it("stacked keys absorb variation", () => {
    assert.equal(key("【DL版】ある作品　第1巻", 5), key("ある作品(1)", 5));
    assert.equal(key("ＡＢＣ・ものがたり", 4), key("abcモノガタリ", 4));
  });

  it("match key helpers", () => {
    assert.equal(titleMatchKey("【DL版】ある作品　第1巻"), key("【DL版】ある作品　第1巻", 5));
    assert.equal(makerMatchKey("メーカー名"), key("メーカー名", 4));
    assert.equal(makerMatchKey(null), "");
  });

  it("dice coefficient", () => {
    assert.equal(dice("あいうえお", "あいうえお"), 1);
    assert.ok(dice("あいうえお", "あいうえおか") > 0.8);
    assert.ok(dice("あいうえお", "まったく別物") < 0.2);
  });
});
