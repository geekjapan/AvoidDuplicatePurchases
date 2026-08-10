import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DiscoveryCandidate } from "../../messages.js";
import { scoreDiscoveryCandidates, titlePreVolumeKey } from "./identity.js";
import { titleMatchKey } from "@adp/shared";

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
    if (result.kind === "candidates") {
      assert.equal(result.candidates.length, 1);
      assert.equal(result.candidates[0]!.cid, "RJ1");
    }
  });

  it("never auto-confirms when origin maker is null", () => {
    const result = scoreDiscoveryCandidates(
      { title: "フォレスティア", maker: null },
      [cand({ cid: "RJ1", title: "フォレスティア", maker: "サークル森", rank: 1 })],
    );
    assert.equal(result.kind, "candidates");
  });

  it("multiple exact matches become picker with only exact rows", () => {
    const result = scoreDiscoveryCandidates(
      { title: "同一タイトル", maker: "同一サークル" },
      [
        cand({ cid: "RJ1", title: "同一タイトル", maker: "同一サークル", rank: 1 }),
        cand({ cid: "RJ2", title: "同一タイトル", maker: "同一サークル", rank: 2 }),
        cand({ cid: "RJ3", title: "無関係", maker: "他", rank: 3 }),
      ],
    );
    assert.equal(result.kind, "candidates");
    if (result.kind === "candidates") {
      assert.equal(result.candidates.length, 2);
      assert.deepEqual(
        result.candidates.map((c) => c.cid),
        ["RJ1", "RJ2"],
      );
    }
  });

  it("volume L5-only match does not unique_exact; wrong volume alone is picker", () => {
    // titleMatchKey strips 巻 markers; pre-L5 keys must still differ for auto.
    assert.equal(titleMatchKey("作品 第1巻"), titleMatchKey("作品 第2巻"));
    assert.notEqual(titlePreVolumeKey("作品 第1巻"), titlePreVolumeKey("作品 第2巻"));

    const onlyWrong = scoreDiscoveryCandidates(
      { title: "作品 第1巻", maker: "作家A" },
      [cand({ cid: "RJ2", title: "作品 第2巻", maker: "作家A", rank: 1 })],
    );
    assert.equal(onlyWrong.kind, "candidates");
    if (onlyWrong.kind === "candidates") {
      assert.equal(onlyWrong.candidates.length, 1);
      assert.equal(onlyWrong.candidates[0]!.cid, "RJ2");
    }

    const multiVolume = scoreDiscoveryCandidates(
      { title: "作品 第1巻", maker: "作家A" },
      [
        cand({ cid: "RJ1", title: "作品 第1巻", maker: "作家A", rank: 1 }),
        cand({ cid: "RJ2", title: "作品 第2巻", maker: "作家A", rank: 2 }),
      ],
    );
    // RJ1 is strict exact → unique_exact auto
    assert.equal(multiVolume.kind, "unique_exact");
    if (multiVolume.kind === "unique_exact") assert.equal(multiVolume.candidate.cid, "RJ1");
  });

  it("unrelated titles are excluded from picker (none when empty relevant)", () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      cand({ cid: `RJ${i}`, title: `作品${i}`, maker: "x", rank: i + 1 }),
    );
    const result = scoreDiscoveryCandidates({ title: "別タイトル", maker: "y" }, many, 10);
    assert.equal(result.kind, "none");
  });

  it("caps multi-exact picker at 10", () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      cand({
        cid: `RJ${i}`,
        title: "同一タイトル",
        maker: "同一サークル",
        rank: i + 1,
      }),
    );
    const result = scoreDiscoveryCandidates(
      { title: "同一タイトル", maker: "同一サークル" },
      many,
      10,
    );
    assert.equal(result.kind, "candidates");
    if (result.kind === "candidates") assert.equal(result.candidates.length, 10);
  });

  it("returns none for empty input", () => {
    assert.equal(scoreDiscoveryCandidates({ title: "a", maker: "b" }, []).kind, "none");
  });

  it("unique_exact for live-like FANZA↔DLsite campaign titles with circle maker", () => {
    // Redacted shape of d_781951 ↔ RJ01652658: wave-dash variants + campaign brackets
    // normalize equal; circle maker alone must unique_exact (not multi-author blob).
    const dlsiteTitle =
      "【2周年記念110円/差分付き】 完堕ち義母とザコマン後輩 ～副題～";
    const fanzaTitle =
      "【2周年記念110円/差分付き】完堕ち義母とザコマン後輩〜副題〜";
    assert.equal(titleMatchKey(dlsiteTitle), titleMatchKey(fanzaTitle));

    const fromFanza = scoreDiscoveryCandidates(
      { title: fanzaTitle, maker: "ろまあぽ" },
      [
        cand({
          cid: "RJ01652658",
          title: dlsiteTitle,
          maker: "ろまあぽ",
          rank: 1,
        }),
      ],
    );
    assert.equal(fromFanza.kind, "unique_exact");

    const fromDlsite = scoreDiscoveryCandidates(
      { title: dlsiteTitle, maker: "ろまあぽ" },
      [
        cand({
          targetSource: "fanza_doujin",
          cid: "d_781951",
          title: fanzaTitle,
          maker: "ろまあぽ",
          productUrl: "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_781951/",
          rank: 1,
        }),
      ],
    );
    assert.equal(fromDlsite.kind, "unique_exact");
  });
});
