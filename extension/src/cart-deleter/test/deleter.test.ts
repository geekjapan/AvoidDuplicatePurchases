import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDeleteRequests, buildRestoreRequests } from "@adp/shared";

import { createCartDeleter } from "../deleter.js";
import { CART_GATE_REFERENCE } from "../gate-reference.js";
import type { FetchFn } from "../types.js";

const TOKEN = "SYNTHETIC_CSRF_TOKEN";
const OWN_URL = "https://book.dmm.co.jp/basket/?fixture=1";

function recordingFetch(
  responses: Array<{ ok: boolean }>,
): { fetchFn: FetchFn; urls: string[]; methods: string[]; bodies: string[] } {
  const urls: string[] = [];
  const methods: string[] = [];
  const bodies: string[] = [];
  let index = 0;
  const fetchFn: FetchFn = async (input, init) => {
    urls.push(String(input));
    methods.push(init?.method ?? "GET");
    bodies.push(typeof init?.body === "string" ? init.body : "");
    const response = responses[index] ?? { ok: true };
    index += 1;
    return { ok: response.ok } as Response;
  };
  return { fetchFn, urls, methods, bodies };
}

describe("cart deleter", () => {
  it("references the human-approved redacted gate marker", () => {
    assert.equal(
      CART_GATE_REFERENCE.issueUrl,
      "https://github.com/geekjapan/AvoidDuplicatePurchases/issues/12",
    );
    assert.equal(CART_GATE_REFERENCE.stores.length, 3);
    assert.ok(CART_GATE_REFERENCE.verifiedCapabilities.includes("live cart _token (FANZA Doujin)"));
  });

  it("runs DLsite per-cid GET delete loop on cart pages", async () => {
    const { fetchFn, urls } = recordingFetch([{ ok: true }, { ok: true }]);
    const deleter = createCartDeleter({
      source: "dlsite",
      pathname: "/maniax/cart",
      context: {},
      fetchFn,
    });
    const result = await deleter.remove(["RJ1", "RJ2"]);
    assert.deepEqual(result, { ok: ["RJ1", "RJ2"], failed: [] });
    assert.equal(urls.length, 2);
    assert.match(urls[0]!, /mode\/nothanks\/product_id\/RJ1/);
    assert.match(urls[1]!, /mode\/nothanks\/product_id\/RJ2/);
  });

  it("reads Doujin _token from cart context for delete/restore", async () => {
    const { fetchFn, bodies } = recordingFetch([{ ok: true }, { ok: true }]);
    const deleter = createCartDeleter({
      source: "fanza-doujin",
      pathname: "/dc/doujin/-/basket/",
      context: { csrfToken: TOKEN },
      fetchFn,
    });
    await deleter.remove(["d_1"]);
    await deleter.restore(["d_1"]);
    assert.equal(bodies.length, 2);
    assert.deepEqual(JSON.parse(bodies[0]!), { product_ids: ["d_1"], _token: TOKEN });
    assert.deepEqual(JSON.parse(bodies[1]!), { product_id: "d_1", _token: TOKEN });
  });

  it("reads Books own_url from cart context for delete/restore", async () => {
    const { fetchFn, bodies } = recordingFetch([{ ok: true }, { ok: true }]);
    const deleter = createCartDeleter({
      source: "fanza-books",
      pathname: "/basket/",
      context: { ownUrl: OWN_URL },
      fetchFn,
    });
    await deleter.remove(["b1"]);
    await deleter.restore(["b1"]);
    const deleteBody = JSON.parse(bodies[0]!);
    const restoreBody = JSON.parse(bodies[1]!);
    assert.equal(deleteBody.own_url, OWN_URL);
    assert.equal(restoreBody.own_url, OWN_URL);
    assert.ok(!("_token" in deleteBody));
  });

  it("blocks removal outside cart pages", async () => {
    const { fetchFn, urls } = recordingFetch([]);
    const deleter = createCartDeleter({
      source: "dlsite",
      pathname: "/maniax/work/=/product_id/RJ123456.html",
      context: {},
      fetchFn,
    });
    const result = await deleter.remove(["RJ1"]);
    assert.deepEqual(result, { ok: [], failed: ["RJ1"] });
    assert.equal(urls.length, 0);
  });

  it("never auto-deletes without explicit remove call", async () => {
    const { fetchFn, urls } = recordingFetch([]);
    createCartDeleter({
      source: "fanza-books",
      pathname: "/basket/",
      context: { ownUrl: OWN_URL },
      fetchFn,
    });
    assert.equal(urls.length, 0);
    assert.equal(buildDeleteRequests("fanza-books", ["b1"], { ownUrl: OWN_URL }).length, 1);
    assert.equal(
      buildRestoreRequests("fanza-doujin", ["d_1"], { csrfToken: TOKEN }).length,
      1,
    );
  });
});
