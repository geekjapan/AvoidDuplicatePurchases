import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { ADP_BANNER_ID } from "../banner.js";
import { extractListingCidsFromAnchors } from "../cid.js";
import { extractProductMeta } from "../meta.js";
import { runProductPageWithLookup } from "../product-runner.js";
import { applyListingOverlays } from "../overlay.js";
import { parseFixtureDocument } from "./mock-document.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, "fixtures");

const SURFACES = [
  {
    name: "dlsite-product",
    file: "dlsite-product.html",
    source: "dlsite" as const,
    url: "https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html",
    cid: "RJ123456",
  },
  {
    name: "fanza-doujin-product",
    file: "fanza-doujin-product.html",
    source: "fanza_doujin" as const,
    url: "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_285449/",
    cid: "d_285449",
  },
  {
    name: "fanza-books-product",
    file: "fanza-books-product.html",
    source: "fanza_books" as const,
    url: "https://book.dmm.co.jp/product/100001/b100xxxxx01001/",
    cid: "b100xxxxx01001",
  },
];

describe("e2e display surfaces", () => {
  for (const surface of SURFACES) {
    it(`extracts product identity from ${surface.name} fixture`, () => {
      const html = readFileSync(join(fixtures, surface.file), "utf8");
      const doc = parseFixtureDocument(html, surface.url);
      const meta = extractProductMeta(surface.source, doc as unknown as Document);
      assert.equal(meta?.cid, surface.cid);
      assert.ok(meta?.title);
    });
  }

  it("shows same-store owned banner on DLsite fixture", async () => {
    const html = readFileSync(join(fixtures, "dlsite-product.html"), "utf8");
    const doc = parseFixtureDocument(
      html,
      "https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html",
    );
    await runProductPageWithLookup(
      "dlsite",
      doc as unknown as Document,
      async () => [{ owned: true, other: [] }],
    );
    const banner = doc.getElementById(ADP_BANNER_ID);
    assert.ok(banner);
    assert.match(banner!.textContent ?? "", /購入済み/);
  });

  it("adds no DOM on lookup failure", async () => {
    const html = readFileSync(join(fixtures, "dlsite-product.html"), "utf8");
    const doc = parseFixtureDocument(
      html,
      "https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html",
    );
    await runProductPageWithLookup("dlsite", doc as unknown as Document, async () => null);
    assert.equal(doc.getElementById(ADP_BANNER_ID), null);
  });

  it("applies listing overlays from same-store cid lookup only", () => {
    const html = readFileSync(join(fixtures, "dlsite-listing.html"), "utf8");
    const doc = parseFixtureDocument(html, "https://www.dlsite.com/maniax/=/keyword/=/");
    const anchors = [...doc.body.children].filter(
      (node) => node.tagName === "A",
    ) as unknown as HTMLAnchorElement[];
    const anchorsByCid = extractListingCidsFromAnchors("dlsite", anchors);
    const ownedByCid = new Map<string, boolean>([
      ["RJ111111", true],
      ["RJ222222", false],
    ]);
    applyListingOverlays(doc as unknown as Document, ownedByCid, anchorsByCid);
    const badges = doc.body.querySelectorAll(".adp-listing-badge");
    assert.equal(badges.length, 1);
  });
});
