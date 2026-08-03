import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  booksDelete,
  buildDeleteRequests,
  buildRestoreRequests,
  dlsiteDelete,
  dlsiteRestore,
  doujinDelete,
} from "../src/cart.js";

describe("cart request builders", () => {
  it("dlsite delete/restore", () => {
    assert.equal(dlsiteDelete("RJ000000").method, "GET");
    assert.match(dlsiteDelete("RJ000000").url, /mode\/nothanks\/product_id\/RJ000000$/);
    assert.match(dlsiteRestore("RJ000000").url, /mode\/cart\/.*product_id\/RJ000000$/);
  });

  it("fanza doujin delete", () => {
    const d = doujinDelete(["d_100001", "d_100002"], "TOKEN");
    assert.equal(d.method, "DELETE");
    assert.deepEqual(JSON.parse(d.body!), {
      product_ids: ["d_100001", "d_100002"],
      _token: "TOKEN",
    });
  });

  it("fanza books delete", () => {
    const b = booksDelete(["b100xxxxx00001"]);
    assert.equal(b.method, "POST");
    const bp = JSON.parse(b.body!);
    assert.deepEqual(bp.items, [{ item_id: "b100xxxxx00001" }]);
    assert.equal(bp.member_type, "member");
    assert.ok(bp.own_url);
    assert.ok(!("_token" in bp));
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

  it("buildRestoreRequests", () => {
    assert.equal(buildRestoreRequests("dlsite", ["RJ1", "RJ2"]).length, 2);
    assert.equal(
      buildRestoreRequests("fanza-doujin", ["d_1", "d_2"], { csrfToken: "T" }).length,
      2,
    );
  });
});
