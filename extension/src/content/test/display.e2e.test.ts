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
import { parseFixtureDocument, type MockElement } from "./mock-document.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, "fixtures");

const PRODUCT_SURFACES = [
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
    url: "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_900001/",
    cid: "d_900001",
  },
  {
    name: "fanza-books-product",
    file: "fanza-books-product.html",
    source: "fanza_books" as const,
    url: "https://book.dmm.co.jp/product/100001/b100xxxxx01001/",
    cid: "b100xxxxx01001",
  },
];

const LISTING_SURFACES = [
  {
    name: "dlsite-listing",
    file: "dlsite-listing.html",
    source: "dlsite" as const,
    url: "https://www.dlsite.com/maniax/=/keyword/=/",
    ownedCid: "RJ111111",
    otherCid: "RJ222222",
  },
  {
    name: "fanza-doujin-listing",
    file: "fanza-doujin-listing.html",
    source: "fanza_doujin" as const,
    url: "https://www.dmm.co.jp/dc/doujin/-/list/=/",
    ownedCid: "d_100001",
    otherCid: "d_100002",
  },
  {
    name: "fanza-books-listing",
    file: "fanza-books-listing.html",
    source: "fanza_books" as const,
    url: "https://book.dmm.co.jp/list/",
    ownedCid: "b100xxxxx01001",
    otherCid: "b100yyyyy00001",
  },
];

function collectAnchors(doc: ReturnType<typeof parseFixtureDocument>): HTMLAnchorElement[] {
  const anchors: MockElement[] = [];
  const visit = (node: MockElement): void => {
    if (node.tagName === "A") anchors.push(node);
    for (const child of node.children) visit(child);
  };
  visit(doc.body);
  return anchors as unknown as HTMLAnchorElement[];
}

describe("e2e display surfaces", () => {
  for (const surface of PRODUCT_SURFACES) {
    it(`extracts product identity from ${surface.name} fixture`, () => {
      const html = readFileSync(join(fixtures, surface.file), "utf8");
      const doc = parseFixtureDocument(html, surface.url);
      const meta = extractProductMeta(surface.source, doc as unknown as Document);
      assert.equal(meta?.cid, surface.cid);
      assert.ok(meta?.title);
    });
  }

  it("shows same-store owned banner with purchase date on DLsite fixture", async () => {
    const html = readFileSync(join(fixtures, "dlsite-product.html"), "utf8");
    const doc = parseFixtureDocument(
      html,
      "https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html",
    );
    await runProductPageWithLookup(
      "dlsite",
      doc as unknown as Document,
      async () => [{ owned: true, purchasedAt: "2023-12-30", other: [] }],
    );
    const banner = doc.getElementById(ADP_BANNER_ID);
    assert.ok(banner);
    assert.equal(banner!.textContent, "✓ 購入済み(2023-12-30)");
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

  for (const surface of LISTING_SURFACES) {
    it(`mounts visible listing badge on non-void host for ${surface.name}`, () => {
      const html = readFileSync(join(fixtures, surface.file), "utf8");
      const doc = parseFixtureDocument(html, surface.url);
      const anchors = collectAnchors(doc);
      assert.ok(anchors.length >= 2, "fixture must expose listing anchors");

      // Preserve image hierarchy from representative fixtures.
      for (const anchor of anchors) {
        const img = (anchor as unknown as MockElement).querySelector("img");
        assert.ok(img, "listing fixture must keep img under anchor");
      }

      const anchorsByCid = extractListingCidsFromAnchors(surface.source, anchors);
      assert.ok(anchorsByCid.has(surface.ownedCid));
      assert.ok(anchorsByCid.has(surface.otherCid));

      const ownedByCid = new Map<string, boolean>([
        [surface.ownedCid, true],
        [surface.otherCid, false],
      ]);
      applyListingOverlays(doc as unknown as Document, ownedByCid, anchorsByCid);

      const badges = doc.body.querySelectorAll(".adp-listing-badge");
      assert.equal(badges.length, 1);
      const badge = badges[0]!;
      assert.notEqual(badge.parent?.tagName, "IMG");
      assert.ok(badge.parent);
      assert.ok(
        badge.parent.tagName === "A" ||
          badge.parent.tagName === "LI" ||
          badge.parent.className.includes("search_result_img_box"),
      );
      // Image remains in the mounted host subtree (container or anchor).
      const host = badge.parent;
      assert.ok(host.querySelector("img") || host.querySelector("a img"));
    });
  }
});
