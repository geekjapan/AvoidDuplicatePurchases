import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DiscoveryCandidate } from "../../messages.js";
import { scoreDiscoveryCandidates } from "./identity.js";

function cand(
  partial: Partial<DiscoveryCandidate> & Pick<DiscoveryCandidate, "cid" | "title">,
): DiscoveryCandidate {
  return {
    targetSource: "dlsite",
    maker: null,
    productUrl: `https://www.dlsite.com/maniax/work/=/product_id/${partial.cid}.html`,
    rank: 1,
    ...partial,
  };
}

describe("discovery identity gate", () => {
  it("unique_exact when maker+title keys match and only one candidate", () => {
    const result = scoreDiscoveryCandidates(
      { title: "フォレスティア", maker: "サークル森" },
      [
        cand({
          cid: "RJ1",
          title: "フォレスティア",
          maker: "サークル森",
          rank: 1,
        }),
        cand({
          cid: "RJ2",
          title: "まったく別",
          maker: "他",
          rank: 2,
        }),
      ],
    );
    assert.equal(result.kind, "unique_exact");
    if (result.kind === "unique_exact") assert.equal(result.candidate.cid, "RJ1");
  });

  it("never auto-confirms title-only match without maker", () => {
    const result = scoreDiscoveryCandidates(
      { title: "フォレスティア", maker: "サークル森" },
      [cand({ cid: "RJ1", title: "フォレスティア", maker: null, rank: 1 })],
    );
    assert.equal(result.kind, "candidates");
    if (result.kind === "candidates") assert.equal(result.candidates.length, 1);
  });

  it("never auto-confirms when origin maker is null", () => {
    const result = scoreDiscoveryCandidates(
      { title: "フォレスティア", maker: null },
      [cand({ cid: "RJ1", title: "フォレスティア", maker: "サークル森", rank: 1 })],
    );
    assert.equal(result.kind, "candidates");
  });

  it("multiple exact matches become picker (no unique_exact)", () => {
    const result = scoreDiscoveryCandidates(
      { title: "同一タイトル", maker: "同一サークル" },
      [
        cand({ cid: "RJ1", title: "同一タイトル", maker: "同一サークル", rank: 1 }),
        cand({ cid: "RJ2", title: "同一タイトル", maker: "同一サークル", rank: 2 }),
      ],
    );
    assert.equal(result.kind, "candidates");
    if (result.kind === "candidates") assert.equal(result.candidates.length, 2);
  });

  it("volume L5-only similarity does not unique_exact against different volume titles with same key", () => {
    // titleMatchKey strips 巻 markers; gate still requires exact key + maker.
    // Two volumes of same series with same maker → both match title keys after L5 → multi exact.
    const result = scoreDiscoveryCandidates(
      { title: "作品 第1巻", maker: "作家A" },
      [
        cand({ cid: "RJ1", title: "作品 第1巻", maker: "作家A", rank: 1 }),
        cand({ cid: "RJ2", title: "作品 第2巻", maker: "作家A", rank: 2 }),
      ],
    );
    // Both collapse to same title key → multi exact → candidates picker
    assert.equal(result.kind, "candidates");
  });

  it("caps picker at 10", () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      cand({ cid: `RJ${i}`, title: `作品${i}`, maker: "x", rank: i + 1 }),
    );
    const result = scoreDiscoveryCandidates({ title: "別", maker: "y" }, many, 10);
    assert.equal(result.kind, "candidates");
    if (result.kind === "candidates") assert.equal(result.candidates.length, 10);
  });

  it("returns none for empty input", () => {
    assert.equal(scoreDiscoveryCandidates({ title: "a", maker: "b" }, []).kind, "none");
  });
});
