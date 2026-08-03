import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { extractCidFromUrl, extractListingCidsFromAnchors } from "../cid.js";

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
        "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_285449/",
      ),
      "d_285449",
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
    assert.equal(extractCidFromUrl("fanza_doujin", doujinUrl!), "d_285449");
    assert.equal(extractCidFromUrl("fanza_books", booksUrl!), "b100xxxxx01001");
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
});
