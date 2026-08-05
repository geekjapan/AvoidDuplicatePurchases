import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { buildCartFixtureDocument } from "./build-cart-fixture.js";
import { parseDlsiteCartRows } from "../parse-dlsite.js";
import {
  fetchDoujinCartRows,
  parseDoujinCartRowsFromPayload,
} from "../parse-doujin.js";
import {
  fetchBooksCartRows,
  parseBooksCartRowsFromPayload,
} from "../parse-books.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, "fixtures");

describe("cart row parsers", () => {
  it("parses DLsite cart rows from DOM and dedupes layout-cloned workno", () => {
    const html = readFileSync(join(fixtures, "dlsite-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(html, "https://www.dlsite.com/maniax/cart");
    // Fixture has 3 li.cart_list_item nodes but RJ123456 is duplicated (layout clone).
    const allItems = Array.from(
      (doc as unknown as Document).querySelectorAll("li"),
    ).filter((el) => el.className.split(/\s+/).includes("cart_list_item"));
    assert.equal(allItems.length, 3, "fixture must include layout-duplicate row");
    const rows = parseDlsiteCartRows(doc as unknown as Document);
    assert.equal(rows.length, 2, "dedupe same normalized workno to one row");
    assert.equal(rows[0]!.cid, "RJ123456");
    assert.equal(rows[0]!.title, "サンプル同人作品");
    assert.equal(rows[0]!.maker, "サークル名");
    assert.equal(rows[1]!.cid, "RJ999999");
    assert.notEqual(rows[0]!.host, doc.body);
  });

  it("rejects invalid DLsite worknos (path/meta) before row creation", () => {
    const html = `<!doctype html><html><body>
      <ul class="cart_list">
        <li class="cart_list_item" data-workno="../../api/sensitive">
          <span class="work_name">evil</span>
        </li>
        <li class="cart_list_item" data-workno="NOT-A-WORKNO">
          <span class="work_name">bad</span>
        </li>
        <li class="cart_list_item" data-workno="RJ123456">
          <span class="work_name">ok</span>
        </li>
      </ul>
    </body></html>`;
    const doc = buildCartFixtureDocument(html, "https://www.dlsite.com/maniax/cart");
    const rows = parseDlsiteCartRows(doc as unknown as Document);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.cid, "RJ123456");
  });

  it("parses canonical FANZA Doujin basket payload (documented shape, synthetic/redacted)", () => {
    const html = readFileSync(join(fixtures, "fanza-doujin-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(
      html,
      "https://www.dmm.co.jp/dc/doujin/-/basket/",
    );
    // Mirrors prototype/fanza/README.md GET /dc/doujin/api/baskets/ shape.
    const rows = parseDoujinCartRowsFromPayload(doc as unknown as Document, {
      error_code: "0",
      error_message: [],
      data: [
        {
          content_id: "d_900001",
          product_id: "d_900001",
          title: "サンプル同人作品",
          maker_name: "サークル名",
          image_src: "https://example.invalid/redacted.jpg",
          price: 10,
          fixed_price: 990,
          basket_price: 9,
          genre: "CG",
          section: "mens",
          campaign_info: {},
          coupon_info: {},
        },
        {
          content_id: "d_100002",
          product_id: "d_100002",
          title: "未購入作品",
          maker_name: "別サークル",
          image_src: "https://example.invalid/redacted2.jpg",
          price: 100,
          fixed_price: 100,
          basket_price: 100,
          genre: "ボイス",
          section: "mens",
        },
      ],
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.cid, "d_900001");
    assert.equal(rows[0]!.title, "サンプル同人作品");
    assert.equal(rows[0]!.maker, "サークル名");
    assert.notEqual(rows[0]!.host, doc.body);
    assert.equal(rows[0]!.host.getAttribute("data-content-id"), "d_900001");
    assert.equal(rows[1]!.host.getAttribute("data-content-id"), "d_100002");
  });

  it("parses FANZA Books basket product ids with DOM titles", () => {
    const html = readFileSync(join(fixtures, "fanza-books-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(html, "https://book.dmm.co.jp/basket/");
    const rows = parseBooksCartRowsFromPayload(doc as unknown as Document, {
      product_ids: ["b100xxxxx01001", "b100yyyyy00001"],
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.cid, "b100xxxxx01001");
    assert.equal(rows[0]!.title, "サンプル書籍");
    assert.equal(rows[0]!.maker, "著者名");
    assert.notEqual(rows[0]!.host, doc.body);
  });

  it("rejects Doujin payload with unknown keys / wrong types / blank cid", () => {
    const html = readFileSync(join(fixtures, "fanza-doujin-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(
      html,
      "https://www.dmm.co.jp/dc/doujin/-/basket/",
    );
    // Unknown item key
    assert.deepEqual(
      parseDoujinCartRowsFromPayload(doc as unknown as Document, {
        error_code: "0",
        error_message: [],
        data: [{ content_id: "d_900001", title: "x", extra: true }],
      }),
      [],
    );
    // Unknown top-level key
    assert.deepEqual(
      parseDoujinCartRowsFromPayload(doc as unknown as Document, {
        error_code: "0",
        data: [{ content_id: "d_900001", title: "x" }],
        unexpected_top: 1,
      }),
      [],
    );
    // Wrong types
    assert.deepEqual(
      parseDoujinCartRowsFromPayload(doc as unknown as Document, {
        data: "not-array",
      }),
      [],
    );
    assert.deepEqual(
      parseDoujinCartRowsFromPayload(doc as unknown as Document, {
        data: [{ content_id: "d_900001", price: "10" }],
      }),
      [],
    );
    // Blank cid
    assert.deepEqual(
      parseDoujinCartRowsFromPayload(doc as unknown as Document, {
        data: [{ content_id: "   ", title: "blank" }],
      }),
      [],
    );
    assert.deepEqual(
      parseDoujinCartRowsFromPayload(doc as unknown as Document, null),
      [],
    );
  });

  it("runtime-case reject: mylibrary camelCase contentId-only / numeric error_code / blank secondary product_id → 0 rows", () => {
    const html = readFileSync(join(fixtures, "fanza-doujin-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(
      html,
      "https://www.dmm.co.jp/dc/doujin/-/basket/",
    );

    // 1) Basket-external mylibrary camelCase contentId/productId-only shape.
    assert.deepEqual(
      parseDoujinCartRowsFromPayload(doc as unknown as Document, {
        error_code: "0",
        data: [
          {
            contentId: "d_900001",
            productId: "d_900001",
            title: "mylibrary-shape",
            makerName: "x",
          },
        ],
      }),
      [],
      "mylibrary camelCase contentId-only must yield 0 rows",
    );

    // 2) Numeric error_code 0 is wrong type (canonical success is string "0").
    assert.deepEqual(
      parseDoujinCartRowsFromPayload(doc as unknown as Document, {
        error_code: 0,
        error_message: [],
        data: [{ content_id: "d_900001", title: "numeric-error-code" }],
      }),
      [],
      "numeric error_code 0 must yield 0 rows",
    );

    // 3) Blank secondary product_id rejects whole item even when content_id valid.
    assert.deepEqual(
      parseDoujinCartRowsFromPayload(doc as unknown as Document, {
        error_code: "0",
        data: [
          {
            content_id: "d_900001",
            product_id: "   ",
            title: "blank-secondary",
          },
        ],
      }),
      [],
      "blank product_id with valid content_id must yield 0 rows",
    );

    // product_id present but inconsistent with content_id → reject.
    assert.deepEqual(
      parseDoujinCartRowsFromPayload(doc as unknown as Document, {
        error_code: "0",
        data: [
          {
            content_id: "d_900001",
            product_id: "d_other",
            title: "mismatch-secondary",
          },
        ],
      }),
      [],
    );
  });

  it("rejects Books payload with unknown keys / wrong types / blank product ids", () => {
    const html = readFileSync(join(fixtures, "fanza-books-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(html, "https://book.dmm.co.jp/basket/");
    assert.deepEqual(
      parseBooksCartRowsFromPayload(doc as unknown as Document, {
        product_ids: ["b100xxxxx01001"],
        extra: 1,
      }),
      [],
    );
    assert.deepEqual(
      parseBooksCartRowsFromPayload(doc as unknown as Document, {
        product_ids: [123],
      }),
      [],
    );
    assert.deepEqual(
      parseBooksCartRowsFromPayload(doc as unknown as Document, {
        product_ids: ["", "  "],
      }),
      [],
    );
    assert.deepEqual(
      parseBooksCartRowsFromPayload(doc as unknown as Document, { ids: [] }),
      [],
    );
  });

  it("skips unmatched Doujin/Books cids and never falls back to document.body", () => {
    const doujinHtml = readFileSync(join(fixtures, "fanza-doujin-cart.html"), "utf8");
    const doujinDoc = buildCartFixtureDocument(
      doujinHtml,
      "https://www.dmm.co.jp/dc/doujin/-/basket/",
    );
    const doujinRows = parseDoujinCartRowsFromPayload(doujinDoc as unknown as Document, {
      data: [
        { content_id: "d_900001", title: "matched" },
        { content_id: "d_unmatched_999", title: "no row" },
      ],
    });
    assert.equal(doujinRows.length, 1);
    assert.equal(doujinRows[0]!.cid, "d_900001");
    assert.notEqual(doujinRows[0]!.host, doujinDoc.body);

    const booksHtml = readFileSync(join(fixtures, "fanza-books-cart.html"), "utf8");
    const booksDoc = buildCartFixtureDocument(booksHtml, "https://book.dmm.co.jp/basket/");
    const booksRows = parseBooksCartRowsFromPayload(booksDoc as unknown as Document, {
      product_ids: ["b100xxxxx01001", "b_unmatched_zzz"],
    });
    assert.equal(booksRows.length, 1);
    assert.equal(booksRows[0]!.cid, "b100xxxxx01001");
    assert.notEqual(booksRows[0]!.host, booksDoc.body);
  });

  it("maps multi-row Doujin/Books fixtures to exact product hosts only", () => {
    const doujinHtml = readFileSync(join(fixtures, "fanza-doujin-cart.html"), "utf8");
    const doujinDoc = buildCartFixtureDocument(
      doujinHtml,
      "https://www.dmm.co.jp/dc/doujin/-/basket/",
    );
    const doujinRows = parseDoujinCartRowsFromPayload(doujinDoc as unknown as Document, {
      data: [
        { content_id: "d_900001", title: "A", maker_name: "M1" },
        { content_id: "d_100002", title: "B", maker_name: "M2" },
      ],
    });
    assert.equal(doujinRows.length, 2);
    assert.equal(doujinRows[0]!.host.getAttribute("data-content-id"), "d_900001");
    assert.equal(doujinRows[1]!.host.getAttribute("data-content-id"), "d_100002");
    assert.notEqual(doujinRows[0]!.host, doujinRows[1]!.host);

    const booksHtml = readFileSync(join(fixtures, "fanza-books-cart.html"), "utf8");
    const booksDoc = buildCartFixtureDocument(booksHtml, "https://book.dmm.co.jp/basket/");
    const booksRows = parseBooksCartRowsFromPayload(booksDoc as unknown as Document, {
      product_ids: ["b100xxxxx01001", "b100yyyyy00001"],
    });
    assert.equal(booksRows.length, 2);
    assert.equal(booksRows[0]!.host.getAttribute("data-item-id"), "b100xxxxx01001");
    assert.equal(booksRows[1]!.host.getAttribute("data-item-id"), "b100yyyyy00001");
    assert.notEqual(booksRows[0]!.host, booksRows[1]!.host);
  });

  it("fetchDoujinCartRows silently returns [] on network reject / non-ok / invalid JSON", async () => {
    const html = readFileSync(join(fixtures, "fanza-doujin-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(
      html,
      "https://www.dmm.co.jp/dc/doujin/-/basket/",
    );

    const rejected = await fetchDoujinCartRows(
      doc as unknown as Document,
      async () => {
        throw new Error("network down");
      },
    );
    assert.deepEqual(rejected, []);

    const nonOk = await fetchDoujinCartRows(
      doc as unknown as Document,
      async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response,
    );
    assert.deepEqual(nonOk, []);

    const badJson = await fetchDoujinCartRows(
      doc as unknown as Document,
      async () =>
        ({
          ok: true,
          json: async () => {
            throw new SyntaxError("not json");
          },
        }) as unknown as Response,
    );
    assert.deepEqual(badJson, []);

    const badSchema = await fetchDoujinCartRows(
      doc as unknown as Document,
      async () =>
        ({
          ok: true,
          json: async () => ({ data: { not: "array" } }),
        }) as unknown as Response,
    );
    assert.deepEqual(badSchema, []);
  });

  it("fetchBooksCartRows silently returns [] on network reject / non-ok / invalid JSON", async () => {
    const html = readFileSync(join(fixtures, "fanza-books-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(html, "https://book.dmm.co.jp/basket/");

    const rejected = await fetchBooksCartRows(
      doc as unknown as Document,
      async () => {
        throw new Error("network down");
      },
    );
    assert.deepEqual(rejected, []);

    const nonOk = await fetchBooksCartRows(
      doc as unknown as Document,
      async () => ({ ok: false, status: 403, json: async () => ({}) }) as Response,
    );
    assert.deepEqual(nonOk, []);

    const badJson = await fetchBooksCartRows(
      doc as unknown as Document,
      async () =>
        ({
          ok: true,
          json: async () => {
            throw new SyntaxError("not json");
          },
        }) as unknown as Response,
    );
    assert.deepEqual(badJson, []);

    const badSchema = await fetchBooksCartRows(
      doc as unknown as Document,
      async () =>
        ({
          ok: true,
          json: async () => ({ product_ids: "nope" }),
        }) as unknown as Response,
    );
    assert.deepEqual(badSchema, []);
  });
});
