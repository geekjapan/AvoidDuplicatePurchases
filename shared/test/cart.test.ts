import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  booksDelete,
  booksRestore,
  buildDeleteRequests,
  buildRestoreRequests,
  dlsiteDelete,
  dlsiteRestore,
  doujinDelete,
  doujinRestore,
} from "../src/cart.js";

describe("cart request builders", () => {
  it("dlsite delete/restore", () => {
    const del = dlsiteDelete("RJ000000");
    assert.equal(del.method, "GET");
    assert.match(del.url, /mode\/nothanks\/product_id\/RJ000000$/);
    assert.deepEqual(del.headers, {});
    assert.equal(del.body, undefined);

    const restore = dlsiteRestore("RJ000000");
    assert.equal(restore.method, "GET");
    assert.match(
      restore.url,
      /mode\/cart\/obj_nocheck\/1\/product_id\/RJ000000$/,
    );
    assert.deepEqual(restore.headers, {});
    assert.equal(restore.body, undefined);
  });

  it("fanza doujin delete", () => {
    const d = doujinDelete(["d_100001", "d_100002"], "TOKEN");
    assert.equal(d.method, "DELETE");
    assert.equal(d.url, "https://www.dmm.co.jp/dc/doujin/api/baskets/");
    assert.deepEqual(JSON.parse(d.body!), {
      product_ids: ["d_100001", "d_100002"],
      _token: "TOKEN",
    });
  });

  it("fanza doujin restore method/url/body/token", () => {
    const r = doujinRestore("d_100001", "TOKEN");
    assert.equal(r.method, "POST");
    assert.equal(r.url, "https://www.dmm.co.jp/dc/doujin/api/baskets/");
    assert.equal(r.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(r.body!), {
      product_id: "d_100001",
      _token: "TOKEN",
    });
  });

  it("fanza books delete", () => {
    const b = booksDelete(["b100xxxxx00001"]);
    assert.equal(b.method, "POST");
    assert.equal(b.url, "https://book.dmm.co.jp/ajax/basket/delete");
    const bp = JSON.parse(b.body!);
    assert.deepEqual(bp.items, [{ item_id: "b100xxxxx00001" }]);
    assert.equal(bp.member_type, "member");
    assert.equal(bp.own_url, "https://book.dmm.co.jp/basket/");
    assert.ok(!("_token" in bp));
  });

  it("fanza books restore method/url/body/own_url", () => {
    const ownUrl = "https://book.dmm.co.jp/basket/?from=test";
    const r = booksRestore(["b100xxxxx00001", "b100xxxxx00002"], ownUrl);
    assert.equal(r.method, "POST");
    assert.equal(r.url, "https://book.dmm.co.jp/ajax/basket/add");
    assert.equal(r.headers["Content-Type"], "application/json");
    const body = JSON.parse(r.body!);
    assert.deepEqual(body.items, [
      { item_id: "b100xxxxx00001" },
      { item_id: "b100xxxxx00002" },
    ]);
    assert.equal(body.member_type, "member");
    assert.equal(body.own_url, ownUrl);
    assert.ok(!("_token" in body));
  });

  it("buildDeleteRequests batches per store rules", () => {
    assert.equal(buildDeleteRequests("dlsite", ["RJ1", "RJ2", "RJ3"]).length, 3);
    assert.equal(
      buildDeleteRequests("fanza-doujin", ["d_1", "d_2"], { csrfToken: "T" }).length,
      1,
    );
    assert.equal(buildDeleteRequests("fanza-books", ["b1", "b2"]).length, 1);
    assert.throws(() => buildDeleteRequests("fanza-doujin", ["d_1"]), /csrf/);
  });

  it("buildRestoreRequests covers all stores with method/url/body contracts", () => {
    const dlsite = buildRestoreRequests("dlsite", ["RJ1", "RJ2"]);
    assert.equal(dlsite.length, 2);
    assert.equal(dlsite[0]?.method, "GET");
    assert.match(dlsite[0]!.url, /product_id\/RJ1$/);
    assert.equal(dlsite[0]?.body, undefined);
    assert.match(dlsite[1]!.url, /product_id\/RJ2$/);

    const doujin = buildRestoreRequests("fanza-doujin", ["d_1", "d_2"], {
      csrfToken: "T",
    });
    assert.equal(doujin.length, 2);
    assert.equal(doujin[0]?.method, "POST");
    assert.equal(doujin[0]?.url, "https://www.dmm.co.jp/dc/doujin/api/baskets/");
    assert.deepEqual(JSON.parse(doujin[0]!.body!), {
      product_id: "d_1",
      _token: "T",
    });
    assert.deepEqual(JSON.parse(doujin[1]!.body!), {
      product_id: "d_2",
      _token: "T",
    });

    const ownUrl = "https://book.dmm.co.jp/basket/custom";
    const books = buildRestoreRequests("fanza-books", ["b1", "b2"], { ownUrl });
    assert.equal(books.length, 1);
    assert.equal(books[0]?.method, "POST");
    assert.equal(books[0]?.url, "https://book.dmm.co.jp/ajax/basket/add");
    const booksBody = JSON.parse(books[0]!.body!);
    assert.deepEqual(booksBody.items, [{ item_id: "b1" }, { item_id: "b2" }]);
    assert.equal(booksBody.member_type, "member");
    assert.equal(booksBody.own_url, ownUrl);
    assert.ok(!("_token" in booksBody));

    assert.throws(() => buildRestoreRequests("fanza-doujin", ["d_1"]), /csrf/);
  });
});
