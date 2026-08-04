import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDeleteRequests, buildRestoreRequests } from "@adp/shared";

import { createCartDeleter } from "../deleter.js";
import { CART_GATE_REFERENCE } from "../gate-reference.js";
import type { FetchFn } from "../types.js";

const TOKEN = "SYNTHETIC_CSRF_TOKEN";
const TOKEN_UPDATED = "SYNTHETIC_CSRF_TOKEN_UPDATED";
const OWN_URL = "https://book.dmm.co.jp/basket/?fixture=1";
const OWN_URL_UPDATED = "https://book.dmm.co.jp/basket/?fixture=2";

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

/** Minimal live document for cart mutation guard tests. */
function liveDoc(opts: {
  href: string;
  pathname?: string;
  csrfToken?: string;
}): Document {
  const pathname = opts.pathname ?? new URL(opts.href).pathname;
  const location = { href: opts.href, pathname };
  const headChildren: Array<{
    getAttribute: (name: string) => string | null;
    content?: string;
  }> = [];
  if (opts.csrfToken) {
    headChildren.push({
      getAttribute: (name: string) =>
        name === "name" ? "csrf-token" : name === "content" ? opts.csrfToken! : null,
      content: opts.csrfToken,
    });
  }
  const doc = {
    location,
    head: {
      querySelector: (sel: string) => {
        if (sel === 'meta[name="csrf-token"]') return headChildren[0] ?? null;
        return null;
      },
    },
    querySelector: (sel: string) => {
      if (sel === 'meta[name="csrf-token"]') return headChildren[0] ?? null;
      return null;
    },
    setPathname(next: string) {
      location.pathname = next;
    },
    setHref(next: string) {
      location.href = next;
      location.pathname = new URL(next).pathname;
    },
    setCsrf(token: string) {
      headChildren[0] = {
        getAttribute: (name: string) =>
          name === "name" ? "csrf-token" : name === "content" ? token : null,
        content: token,
      };
    },
  };
  return doc as unknown as Document & {
    setPathname: (p: string) => void;
    setHref: (h: string) => void;
    setCsrf: (t: string) => void;
  };
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
    const doc = liveDoc({ href: "https://www.dlsite.com/maniax/cart" });
    const deleter = createCartDeleter({
      source: "dlsite",
      doc,
      fetchFn,
    });
    const result = await deleter.remove(["RJ1", "RJ2"]);
    assert.deepEqual(result, { ok: ["RJ1", "RJ2"], failed: [] });
    assert.equal(urls.length, 2);
    assert.match(urls[0]!, /mode\/nothanks\/product_id\/RJ1/);
    assert.match(urls[1]!, /mode\/nothanks\/product_id\/RJ2/);
  });

  it("re-reads Doujin _token from live document for delete/restore", async () => {
    const { fetchFn, bodies } = recordingFetch([{ ok: true }, { ok: true }]);
    const doc = liveDoc({
      href: "https://www.dmm.co.jp/dc/doujin/-/basket/",
      csrfToken: TOKEN,
    }) as Document & { setCsrf: (t: string) => void };
    const deleter = createCartDeleter({
      source: "fanza-doujin",
      doc,
      fetchFn,
    });
    await deleter.remove(["d_1"]);
    doc.setCsrf(TOKEN_UPDATED);
    await deleter.restore(["d_1"]);
    assert.equal(bodies.length, 2);
    assert.deepEqual(JSON.parse(bodies[0]!), { product_ids: ["d_1"], _token: TOKEN });
    assert.deepEqual(JSON.parse(bodies[1]!), {
      product_id: "d_1",
      _token: TOKEN_UPDATED,
    });
  });

  it("re-reads Books own_url from live location for delete/restore", async () => {
    const { fetchFn, bodies } = recordingFetch([{ ok: true }, { ok: true }]);
    const doc = liveDoc({ href: OWN_URL }) as Document & {
      setHref: (h: string) => void;
    };
    const deleter = createCartDeleter({
      source: "fanza-books",
      doc,
      fetchFn,
    });
    await deleter.remove(["b1"]);
    doc.setHref(OWN_URL_UPDATED);
    await deleter.restore(["b1"]);
    const deleteBody = JSON.parse(bodies[0]!);
    const restoreBody = JSON.parse(bodies[1]!);
    assert.equal(deleteBody.own_url, OWN_URL);
    assert.equal(restoreBody.own_url, OWN_URL_UPDATED);
    assert.ok(!("_token" in deleteBody));
  });

  it("blocks removal outside cart pages at invocation time (zero fetch)", async () => {
    const { fetchFn, urls } = recordingFetch([]);
    const doc = liveDoc({
      href: "https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html",
    });
    const deleter = createCartDeleter({
      source: "dlsite",
      doc,
      fetchFn,
    });
    const result = await deleter.remove(["RJ1"]);
    assert.deepEqual(result, { ok: [], failed: ["RJ1"] });
    assert.equal(urls.length, 0);
  });

  it("after mount, navigation outside cart then click: zero fetch for all stores", async () => {
    const cases: Array<{
      source: "dlsite" | "fanza-doujin" | "fanza-books";
      cartHref: string;
      outsidePath: string;
      csrfToken?: string;
    }> = [
      {
        source: "dlsite",
        cartHref: "https://www.dlsite.com/maniax/cart",
        outsidePath: "/maniax/work/=/product_id/RJ123456.html",
      },
      {
        source: "fanza-doujin",
        cartHref: "https://www.dmm.co.jp/dc/doujin/-/basket/",
        outsidePath: "/dc/doujin/-/detail/=/cid=d_900001/",
        csrfToken: TOKEN,
      },
      {
        source: "fanza-books",
        cartHref: OWN_URL,
        outsidePath: "/product/100001/b100xxxxx01001/",
      },
    ];

    for (const c of cases) {
      const { fetchFn, urls } = recordingFetch([{ ok: true }]);
      const doc = liveDoc({
        href: c.cartHref,
        csrfToken: c.csrfToken,
      }) as Document & { setPathname: (p: string) => void };
      const deleter = createCartDeleter({
        source: c.source,
        doc,
        fetchFn,
      });
      // Simulate SPA / navigation away from cart after mount.
      doc.setPathname(c.outsidePath);
      const result = await deleter.remove(["cid1"]);
      assert.deepEqual(result, { ok: [], failed: ["cid1"] }, c.source);
      assert.equal(urls.length, 0, `${c.source} must not fetch outside cart`);
      await deleter.restore(["cid1"]);
      assert.equal(urls.length, 0, `${c.source} restore must not fetch outside cart`);
    }
  });

  it("never auto-deletes without explicit remove call", async () => {
    const { fetchFn, urls } = recordingFetch([]);
    createCartDeleter({
      source: "fanza-books",
      doc: liveDoc({ href: OWN_URL }),
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
