import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDiscoverySearchUrls,
  buildDiscoverySearchUrl,
  counterpartSource,
  DLSITE_TITLE_CODEPOINT_LIMIT,
  FANZA_DOUJIN_TITLE_CODEPOINT_LIMIT,
  MAX_URL_LENGTH,
  sanitizeSearchTitle,
  truncateCodePoints,
} from "./search-url.js";

describe("discovery search URL builder", () => {
  it("builds DLsite maniax keyword URL with encodeURIComponent", () => {
    const result = buildDiscoverySearchUrl("dlsite", "フォレスティア");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(
      result.url,
      `https://www.dlsite.com/maniax/fsr/=/keyword/${encodeURIComponent("フォレスティア")}/`,
    );
    assert.equal(result.truncated, false);
  });

  it("builds FANZA doujin narrow word URL", () => {
    const result = buildDiscoverySearchUrl("fanza_doujin", "テスト作品");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(
      result.url,
      `https://www.dmm.co.jp/dc/doujin/-/list/narrow/=/word=${encodeURIComponent("テスト作品")}/`,
    );
  });

  it("strips control characters from title", () => {
    assert.equal(sanitizeSearchTitle("あ\nい\tう\u0000"), "あ い う");
  });

  it("truncates DLsite titles at 255 code points (ASCII stays under URL cap)", () => {
    const long = "a".repeat(DLSITE_TITLE_CODEPOINT_LIMIT + 10);
    const result = buildDiscoverySearchUrl("dlsite", long);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.truncated, true);
    assert.equal([...result.keyword].length, DLSITE_TITLE_CODEPOINT_LIMIT);
    assert.ok(result.url.length <= MAX_URL_LENGTH);
  });

  it("truncates FANZA titles at 100 code points", () => {
    const long = "b".repeat(FANZA_DOUJIN_TITLE_CODEPOINT_LIMIT + 5);
    const result = buildDiscoverySearchUrl("fanza_doujin", long);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.truncated, true);
    assert.equal([...result.keyword].length, FANZA_DOUJIN_TITLE_CODEPOINT_LIMIT);
  });

  it("fails closed when encoded URL would exceed 2000 chars", () => {
    // JP code points expand under percent-encoding; even after 255 cap the URL can exceed 2000.
    const title = "あ".repeat(DLSITE_TITLE_CODEPOINT_LIMIT);
    const result = buildDiscoverySearchUrl("dlsite", title);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "url_too_long");
  });

  it("rejects empty keyword after sanitize", () => {
    const result = buildDiscoverySearchUrl("dlsite", "\n\t  ");
    assert.equal(result.ok, false);
  });

  it("maps counterparts for wave-1 only", () => {
    assert.equal(counterpartSource("dlsite"), "fanza_doujin");
    assert.equal(counterpartSource("fanza_doujin"), "dlsite");
  });

  it("creates fallback keywords for a long cross-store title", () => {
    const title =
      "【2周年記念110円/ドスケベ差分イラスト付き】完堕ち義母とザコマン後輩があなたのチンポを貪り喰らう～義母のガチ恋裏アリ強気メスをハメ堕としド下品3P交尾～";
    const result = buildDiscoverySearchUrls("dlsite", title);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const keywords = result.queries.map((query) => query.keyword);
    assert.ok(keywords.includes(title));
    assert.ok(keywords.includes("完堕ち義母とザコマン後輩があなたのチンポを貪り喰らう"));
    assert.ok(keywords.some((keyword) => keyword.startsWith("完堕ち義母とザコマン後輩")));
    assert.ok(new Set(keywords).size >= 3);
  });

  it("truncates on code-point boundary for surrogate pairs", () => {
    const emoji = "😀"; // one code point, two UTF-16 units
    const { text, truncated } = truncateCodePoints(emoji.repeat(3), 2);
    assert.equal(truncated, true);
    assert.equal([...text].length, 2);
  });
});
