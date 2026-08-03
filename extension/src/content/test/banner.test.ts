import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  approvedStoreHttpsUrl,
  formatOwnedBannerText,
  formatPurchaseDate,
  renderProductBanner,
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

  it("rejects non-https or non-approved host links", () => {
    assert.equal(approvedStoreHttpsUrl("javascript:alert(1)"), null);
    assert.equal(approvedStoreHttpsUrl("http://www.dlsite.com/x"), null);
    assert.equal(approvedStoreHttpsUrl("https://evil.example/x"), null);

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
});
