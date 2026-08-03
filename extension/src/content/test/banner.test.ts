import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatOtherBannerHtml,
  formatOwnedBannerText,
  renderProductBanner,
} from "../banner.js";
import { MockDocument } from "./mock-document.js";

describe("content banner rendering", () => {
  it("formats same-store owned indicator", () => {
    assert.equal(formatOwnedBannerText(), "✓ 購入済み");
  });

  it("formats cross-store warning with verified product link", () => {
    const html = formatOtherBannerHtml({
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
    assert.match(html ?? "", /他サイトで購入済み/);
    assert.match(html ?? "", /DLsite/);
    assert.match(html ?? "", /RJ123456\.html/);
  });

  it("does not render cross-store banner for fuzzy-only lookup results", () => {
    const doc = new MockDocument();
    const banner = renderProductBanner(doc as unknown as Document, {
      owned: false,
      other: [],
    });
    assert.equal(banner, null);
  });
});
