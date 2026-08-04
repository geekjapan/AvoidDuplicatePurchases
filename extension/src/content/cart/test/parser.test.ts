import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { buildCartFixtureDocument } from "./build-cart-fixture.js";
import { parseDlsiteCartRows } from "../parse-dlsite.js";
import { parseDoujinCartRowsFromPayload } from "../parse-doujin.js";
import { parseBooksCartRowsFromPayload } from "../parse-books.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, "fixtures");

describe("cart row parsers", () => {
  it("parses DLsite cart rows from DOM", () => {
    const html = readFileSync(join(fixtures, "dlsite-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(html, "https://www.dlsite.com/maniax/cart");
    const rows = parseDlsiteCartRows(doc as unknown as Document);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.cid, "RJ123456");
    assert.equal(rows[0]!.title, "サンプル同人作品");
    assert.equal(rows[0]!.maker, "サークル名");
  });

  it("parses FANZA Doujin basket API payload with redacted synthetic ids", () => {
    const html = readFileSync(join(fixtures, "fanza-doujin-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(
      html,
      "https://www.dmm.co.jp/dc/doujin/-/basket/",
    );
    const rows = parseDoujinCartRowsFromPayload(doc as unknown as Document, {
      data: [
        {
          content_id: "d_900001",
          title: "サンプル同人作品",
          maker_name: "サークル名",
        },
        { content_id: "d_100002", title: "未購入作品", maker_name: "別サークル" },
      ],
    });
    assert.equal(rows[0]!.cid, "d_900001");
    assert.equal(rows[0]!.title, "サンプル同人作品");
  });

  it("parses FANZA Books basket product ids with DOM titles", () => {
    const html = readFileSync(join(fixtures, "fanza-books-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(html, "https://book.dmm.co.jp/basket/");
    const rows = parseBooksCartRowsFromPayload(doc as unknown as Document, {
      product_ids: ["b100xxxxx01001", "b100yyyyy00001"],
    });
    assert.equal(rows[0]!.cid, "b100xxxxx01001");
    assert.equal(rows[0]!.title, "サンプル書籍");
    assert.equal(rows[0]!.maker, "著者名");
  });
});
