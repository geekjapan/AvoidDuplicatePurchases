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

  it("rejects blanket bracket removal", () => {
    assert.equal(
      stripAllBrackets("作品【演者A】"),
      stripAllBrackets("作品【演者B】"),
    );
    assert.throws(() => assertNormalizationSelfCheck(), /regression/);
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
