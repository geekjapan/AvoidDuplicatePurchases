import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  approvedStoreHttpsUrl,
  formatOwnedBannerText,
  formatPurchaseDate,
  renderProductBanner,
  selectRenderableOther,
} from "../banner.js";
import { MockDocument } from "./mock-document.js";

describe("content banner rendering", () => {
  it("formats same-store owned indicator with available purchase date", () => {
    assert.equal(formatOwnedBannerText("2023-12-30T12:00:00.000Z"), "✓ 購入済み(2023-12-30)");
    assert.equal(formatOwnedBannerText("2023-12-30"), "✓ 購入済み(2023-12-30)");
    assert.equal(formatOwnedBannerText(null), "✓ 購入済み");
    assert.equal(formatPurchaseDate("2023-12-30T01:02:03Z"), "2023-12-30");
  });

  it("builds cross-store warning with DOM nodes and approved https link", () => {
    const doc = new MockDocument();
    const banner = renderProductBanner(doc as unknown as Document, {
      owned: false,
      other: [
        {
          source: "dlsite",
          cid: "RJ123456",
          title: "サンプル作品",
          url: "https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html",
        },
      ],
    });
    assert.ok(banner);
    assert.match(banner!.textContent ?? "", /他サイトで購入済み/);
    const link = banner!.querySelector("a");
    assert.ok(link);
    assert.match(link!.href, /RJ123456\.html/);
    assert.match(link!.textContent ?? "", /DLsite/);
    assert.match(link!.textContent ?? "", /サンプル作品/);
  });

  it("does not render cross-store banner for fuzzy-only lookup results", () => {
    const doc = new MockDocument();
    const banner = renderProductBanner(doc as unknown as Document, {
      owned: false,
      other: [],
    });
    assert.equal(banner, null);
  });

  it("rejects non-https or non-approved host/path links per source", () => {
    assert.equal(approvedStoreHttpsUrl("javascript:alert(1)", "dlsite"), null);
    assert.equal(approvedStoreHttpsUrl("http://www.dlsite.com/maniax/work/=/product_id/RJ1.html", "dlsite"), null);
    assert.equal(approvedStoreHttpsUrl("https://evil.example/x", "dlsite"), null);
    // Host alone is not enough — path must match the lookup-contract product shape.
    assert.equal(approvedStoreHttpsUrl("https://www.dlsite.com/maniax/", "dlsite"), null);
    assert.equal(
      approvedStoreHttpsUrl("https://video.dmm.co.jp/digital/videoa/-/detail/=/cid=x/", "fanza_video"),
      null,
    );
    assert.equal(
      approvedStoreHttpsUrl("https://dlsoft.dmm.co.jp/list/", "fanza_dlsoft"),
      null,
    );
    // Source/host mismatch must fail even when both are known store hosts.
    assert.equal(
      approvedStoreHttpsUrl(
        "https://www.dlsite.com/maniax/work/=/product_id/RJ1.html",
        "fanza_video",
      ),
      null,
    );

    const doc = new MockDocument();
    const banner = renderProductBanner(doc as unknown as Document, {
      owned: false,
      other: [
        {
          source: "dlsite",
          cid: "RJ1",
          title: "<img src=x onerror=alert(1)>",
          url: "javascript:alert(1)",
        },
      ],
    });
    assert.equal(banner, null);
  });

  it("accepts lookup-contract product URLs for every source", () => {
    assert.equal(
      approvedStoreHttpsUrl(
        "https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html",
        "dlsite",
      ),
      "https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html",
    );
    assert.equal(
      approvedStoreHttpsUrl(
        "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_900001/",
        "fanza_doujin",
      ),
      "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_900001/",
    );
    assert.equal(
      approvedStoreHttpsUrl(
        "https://book.dmm.co.jp/product/100001/b100xxxxx01001/",
        "fanza_books",
      ),
      "https://book.dmm.co.jp/product/100001/b100xxxxx01001/",
    );
    assert.equal(
      approvedStoreHttpsUrl(
        "https://video.dmm.co.jp/av/content/?id=synthetic_av_900001",
        "fanza_video",
      ),
      "https://video.dmm.co.jp/av/content/?id=synthetic_av_900001",
    );
    assert.equal(
      approvedStoreHttpsUrl(
        "https://video.dmm.co.jp/amateur/content/?id=synthetic_amateur_900001",
        "fanza_video",
      ),
      "https://video.dmm.co.jp/amateur/content/?id=synthetic_amateur_900001",
    );
    assert.equal(
      approvedStoreHttpsUrl(
        "https://dlsoft.dmm.co.jp/detail/synthetic_dlsoft_900001/",
        "fanza_dlsoft",
      ),
      "https://dlsoft.dmm.co.jp/detail/synthetic_dlsoft_900001/",
    );
  });

  it("renders FANZA Video cross-store warning with approved video.dmm.co.jp link", () => {
    const doc = new MockDocument();
    const banner = renderProductBanner(doc as unknown as Document, {
      owned: false,
      other: [
        {
          source: "fanza_video",
          cid: "synthetic_av_900001",
          title: "サンプル動画",
          url: "https://video.dmm.co.jp/av/content/?id=synthetic_av_900001",
        },
      ],
    });
    assert.ok(banner);
    const link = banner!.querySelector("a");
    assert.ok(link);
    assert.equal(link!.href, "https://video.dmm.co.jp/av/content/?id=synthetic_av_900001");
    assert.match(link!.textContent ?? "", /FANZA動画/);
    assert.match(link!.textContent ?? "", /サンプル動画/);
  });

  it("renders FANZA PC-game cross-store warning with approved dlsoft.dmm.co.jp link", () => {
    const doc = new MockDocument();
    const banner = renderProductBanner(doc as unknown as Document, {
      owned: false,
      other: [
        {
          source: "fanza_dlsoft",
          cid: "synthetic_dlsoft_900001",
          title: "サンプルPCゲーム",
          url: "https://dlsoft.dmm.co.jp/detail/synthetic_dlsoft_900001/",
        },
      ],
    });
    assert.ok(banner);
    const link = banner!.querySelector("a");
    assert.ok(link);
    assert.equal(link!.href, "https://dlsoft.dmm.co.jp/detail/synthetic_dlsoft_900001/");
    assert.match(link!.textContent ?? "", /FANZA PCゲーム/);
    assert.match(link!.textContent ?? "", /サンプルPCゲーム/);
  });

  it("skips invalid/unsupported first other and renders later safe exact match", () => {
    const selected = selectRenderableOther([
      {
        source: "fanza_video",
        cid: "bad",
        title: "壊れた候補",
        url: "https://video.dmm.co.jp/digital/videoa/-/detail/=/cid=bad/",
      },
      {
        source: "unknown_source",
        cid: "x",
        title: "未知ソース",
        url: "https://www.dlsite.com/maniax/work/=/product_id/RJ1.html",
      },
      {
        source: "fanza_dlsoft",
        cid: "synthetic_dlsoft_900001",
        title: "安全なPCゲーム",
        url: "https://dlsoft.dmm.co.jp/detail/synthetic_dlsoft_900001/",
      },
    ]);
    assert.ok(selected);
    assert.equal(selected!.other.source, "fanza_dlsoft");
    assert.equal(selected!.safeUrl, "https://dlsoft.dmm.co.jp/detail/synthetic_dlsoft_900001/");

    const doc = new MockDocument();
    const banner = renderProductBanner(doc as unknown as Document, {
      owned: false,
      other: [
        {
          source: "fanza_books",
          cid: "noseries",
          title: "URL不正",
          url: "https://book.dmm.co.jp/",
        },
        {
          source: "fanza_video",
          cid: "synthetic_av_900001",
          title: "後続の安全な動画",
          url: "https://video.dmm.co.jp/av/content/?id=synthetic_av_900001",
        },
      ],
    });
    assert.ok(banner);
    const link = banner!.querySelector("a");
    assert.ok(link);
    assert.equal(link!.href, "https://video.dmm.co.jp/av/content/?id=synthetic_av_900001");
    assert.match(link!.textContent ?? "", /FANZA動画/);
    assert.match(link!.textContent ?? "", /後続の安全な動画/);
  });
});
