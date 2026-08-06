import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  extractCidFromDocument,
  extractCidFromUrl,
  extractListingCidsFromAnchors,
} from "../cid.js";
import { parseFixtureDocument } from "./mock-document.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, "fixtures");

function fixture(name: string): string {
  return readFileSync(join(fixtures, name), "utf8");
}

describe("content cid extraction", () => {
  it("extracts DLsite workno from product URLs", () => {
    assert.equal(
      extractCidFromUrl("dlsite", "https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html"),
      "RJ123456",
    );
  });

  it("extracts FANZA doujin cid from detail URLs", () => {
    assert.equal(
      extractCidFromUrl(
        "fanza_doujin",
        "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_900001/",
      ),
      "d_900001",
    );
  });

  it("extracts FANZA books content_id from product URLs", () => {
    assert.equal(
      extractCidFromUrl(
        "fanza_books",
        "https://book.dmm.co.jp/product/100001/b100xxxxx01001/",
      ),
      "b100xxxxx01001",
    );
  });

  it("reads representative fixture canonical URLs for all three stores", () => {
    const dlsiteUrl = fixture("dlsite-product.html").match(
      /property="og:url" content="([^"]+)"/,
    )?.[1];
    const doujinUrl = fixture("fanza-doujin-product.html").match(
      /property="og:url" content="([^"]+)"/,
    )?.[1];
    const booksUrl = fixture("fanza-books-product.html").match(
      /property="og:url" content="([^"]+)"/,
    )?.[1];

    assert.equal(extractCidFromUrl("dlsite", dlsiteUrl!), "RJ123456");
    assert.equal(extractCidFromUrl("fanza_doujin", doujinUrl!), "d_900001");
    assert.equal(extractCidFromUrl("fanza_books", booksUrl!), "b100xxxxx01001");
  });

  it("prefers canonical/og:url over a differing location.href", () => {
    const html = fixture("fanza-doujin-product.html");
    const doc = parseFixtureDocument(
      html,
      "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_location_noise/",
    );
    assert.equal(doc.location.href.includes("d_location_noise"), true);
    const cid = extractCidFromDocument("fanza_doujin", doc as unknown as Document);
    assert.equal(cid, "d_900001");
  });

  it("falls back to location.href when canonical/og are absent", () => {
    const doc = parseFixtureDocument(
      "<html><body><h1>x</h1></body></html>",
      "https://www.dlsite.com/maniax/work/=/product_id/RJ654321.html",
    );
    assert.equal(
      extractCidFromDocument("dlsite", doc as unknown as Document),
      "RJ654321",
    );
  });

  it("collects listing cids from fixture anchors only", () => {
    const html = fixture("dlsite-listing.html");
    const anchors = [...html.matchAll(/<a href="([^"]+)"/g)].map((match) => {
      const anchor = Object.assign(new URL(match[1]!, "https://www.dlsite.com"), {
        href: match[1]!,
      });
      return anchor as unknown as HTMLAnchorElement;
    });
    const map = extractListingCidsFromAnchors("dlsite", anchors);
    assert.deepEqual([...map.keys()].sort(), ["RJ111111", "RJ222222"]);
  });

  it("rejects external host product-shaped paths", () => {
    assert.equal(
      extractCidFromUrl(
        "dlsite",
        "https://evil.example/maniax/work/=/product_id/RJ123456.html",
      ),
      null,
    );
    assert.equal(
      extractCidFromUrl(
        "fanza_doujin",
        "https://evil.example/dc/doujin/-/detail/=/cid=d_900001/",
      ),
      null,
    );
    assert.equal(
      extractCidFromUrl(
        "fanza_books",
        "https://evil.example/product/100001/b100xxxxx01001/",
      ),
      null,
    );
  });

  it("rejects lookalike hosts that only suffix-match the store domain", () => {
    assert.equal(
      extractCidFromUrl(
        "dlsite",
        "https://www.dlsite.com.evil.example/maniax/work/=/product_id/RJ123456.html",
      ),
      null,
    );
    assert.equal(
      extractCidFromUrl(
        "fanza_doujin",
        "https://www.dmm.co.jp.evil.example/dc/doujin/-/detail/=/cid=d_900001/",
      ),
      null,
    );
    assert.equal(
      extractCidFromUrl(
        "fanza_books",
        "https://book.dmm.co.jp.evil.example/product/100001/b100xxxxx01001/",
      ),
      null,
    );
  });

  it("rejects wrong path shapes on canonical hosts", () => {
    assert.equal(
      extractCidFromUrl("dlsite", "https://www.dlsite.com/maniax/cart"),
      null,
    );
    assert.equal(
      extractCidFromUrl(
        "fanza_doujin",
        "https://www.dmm.co.jp/dc/doujin/-/basket/",
      ),
      null,
    );
    assert.equal(
      extractCidFromUrl("fanza_books", "https://book.dmm.co.jp/list/"),
      null,
    );
    // Cross-store host/path mismatch must not yield a cid for the wrong source.
    assert.equal(
      extractCidFromUrl(
        "fanza_doujin",
        "https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html",
      ),
      null,
    );
  });

  it("rejects non-HTTPS URLs even with canonical hosts and paths", () => {
    assert.equal(
      extractCidFromUrl(
        "dlsite",
        "http://www.dlsite.com/maniax/work/=/product_id/RJ123456.html",
      ),
      null,
    );
    assert.equal(
      extractCidFromUrl(
        "fanza_doujin",
        "http://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_900001/",
      ),
      null,
    );
    assert.equal(
      extractCidFromUrl(
        "fanza_books",
        "http://book.dmm.co.jp/product/100001/b100xxxxx01001/",
      ),
      null,
    );
  });
});
