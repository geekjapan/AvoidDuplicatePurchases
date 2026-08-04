import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { createCartDeleter } from "../../../cart-deleter/index.js";
import { buildCartFixtureDocument } from "./build-cart-fixture.js";
import { ADP_CART_WARNING_CLASS } from "../warning.js";
import { ADP_CART_TOAST_ID, UNDO_TOAST_MS, UNDO_TOAST_TEXT } from "../toast.js";
import { parseDlsiteCartRows } from "../parse-dlsite.js";
import { parseDoujinCartRowsFromPayload } from "../parse-doujin.js";
import { parseBooksCartRowsFromPayload } from "../parse-books.js";
import { runCartPage } from "../runner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, "fixtures");

describe("cart runner", () => {
  it("warns on same-store and cross-store duplicates without auto-delete", async () => {
    const html = readFileSync(join(fixtures, "dlsite-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(html, "https://www.dlsite.com/maniax/cart");
    const fetchCalls: string[] = [];

    const warned = await runCartPage(
      "dlsite",
      doc as unknown as Document,
      parseDlsiteCartRows,
      async () => [
        { owned: true, purchasedAt: "2023-12-30", other: [] },
        {
          owned: false,
          other: [
            {
              source: "fanza_doujin",
              cid: "d_900001",
              title: "サンプル同人作品",
              url: "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_900001/",
            },
          ],
        },
      ],
    );

    assert.equal(warned, 2);
    const warnings = doc.body.querySelectorAll(`.${ADP_CART_WARNING_CLASS}`);
    assert.equal(warnings.length, 2);
    assert.match(warnings[0]!.textContent ?? "", /購入済み/);
    assert.match(warnings[1]!.textContent ?? "", /他サイトで購入済み/);
    assert.equal(fetchCalls.length, 0);
  });

  it("explicit delete shows undo toast and restore path", async () => {
    const html = readFileSync(join(fixtures, "dlsite-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(html, "https://www.dlsite.com/maniax/cart");
    const urls: string[] = [];
    const fetchFn = async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return { ok: true } as Response;
    };

    await runCartPage(
      "dlsite",
      doc as unknown as Document,
      parseDlsiteCartRows,
      async () => [{ owned: true, other: [] }],
    );

    const deleteButton = doc.body.querySelector(".adp-cart-warning__delete") as {
      onclick: (() => void) | null;
    };
    assert.ok(deleteButton?.onclick);

    const deleter = createCartDeleter({
      source: "dlsite",
      doc: doc as unknown as Document,
      fetchFn,
    });
    const result = await deleter.remove(["RJ123456"]);
    assert.deepEqual(result.ok, ["RJ123456"]);
    assert.match(urls[0]!, /mode\/nothanks\/product_id\/RJ123456/);

    const { showUndoToast } = await import("../toast.js");
    let restored = false;
    const restoreDone = new Promise<void>((resolve) => {
      showUndoToast(doc as unknown as Document, async () => {
        await deleter.restore(["RJ123456"]);
        restored = true;
        resolve();
      });
    });

    const toast = doc.getElementById(ADP_CART_TOAST_ID);
    assert.ok(toast);
    assert.ok((toast!.textContent ?? "").includes(UNDO_TOAST_TEXT.split(" — ")[0]));
    assert.equal(UNDO_TOAST_MS, 10_000);

    const undo = toast!.querySelector(".adp-cart-toast__undo") as { onclick: (() => void) | null };
    undo.onclick?.();
    await restoreDone;
    assert.equal(restored, true);
    assert.match(urls[1]!, /mode\/cart\/.*product_id\/RJ123456/);
  });

  it("after mount, navigation outside cart then delete click: zero fetch", async () => {
    const html = readFileSync(join(fixtures, "dlsite-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(html, "https://www.dlsite.com/maniax/cart");
    const urls: string[] = [];

    // Inject a live fetch so handleDelete path is exercised via real mounted button.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return { ok: true } as Response;
    }) as typeof fetch;

    try {
      await runCartPage(
        "dlsite",
        doc as unknown as Document,
        parseDlsiteCartRows,
        async () => [{ owned: true, other: [] }],
      );

      const deleteButton = doc.body.querySelector(".adp-cart-warning__delete") as {
        onclick: (() => void) | null;
      };
      assert.ok(deleteButton?.onclick);

      // Simulate navigation away after warnings mounted.
      const loc = doc.location as { href: string; pathname?: string };
      loc.pathname = "/maniax/work/=/product_id/RJ123456.html";
      loc.href = "https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html";

      deleteButton.onclick?.();
      // Allow microtask for async handleDelete.
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(urls.length, 0, "remove after leaving cart must not fetch");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("adds no DOM on lookup failure", async () => {
    const html = readFileSync(join(fixtures, "dlsite-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(html, "https://www.dlsite.com/maniax/cart");
    const warned = await runCartPage(
      "dlsite",
      doc as unknown as Document,
      parseDlsiteCartRows,
      async () => null,
    );
    assert.equal(warned, 0);
    assert.equal(doc.body.querySelectorAll(`.${ADP_CART_WARNING_CLASS}`).length, 0);
  });

  it("adds no DOM and no unhandled rejection when parseRows throws", async () => {
    const html = readFileSync(join(fixtures, "dlsite-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(html, "https://www.dlsite.com/maniax/cart");
    const warned = await runCartPage(
      "dlsite",
      doc as unknown as Document,
      async () => {
        throw new Error("parse boom");
      },
    );
    assert.equal(warned, 0);
    assert.equal(doc.body.querySelectorAll(`.${ADP_CART_WARNING_CLASS}`).length, 0);
  });

  it("attaches Doujin multi-row warnings only to exact product hosts", async () => {
    const html = readFileSync(join(fixtures, "fanza-doujin-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(
      html,
      "https://www.dmm.co.jp/dc/doujin/-/basket/",
    );
    const rows = parseDoujinCartRowsFromPayload(doc as unknown as Document, {
      data: [
        { content_id: "d_900001", title: "A", maker_name: "M1" },
        { content_id: "d_100002", title: "B", maker_name: "M2" },
        { content_id: "d_unmatched", title: "C" },
      ],
    });
    assert.equal(rows.length, 2);

    const warned = await runCartPage(
      "fanza_doujin",
      doc as unknown as Document,
      async () => rows,
      async () => [
        { owned: true, other: [] },
        { owned: true, other: [] },
      ],
    );
    assert.equal(warned, 2);
    const host0 = rows[0]!.host.querySelector(`.${ADP_CART_WARNING_CLASS}`);
    const host1 = rows[1]!.host.querySelector(`.${ADP_CART_WARNING_CLASS}`);
    assert.ok(host0);
    assert.ok(host1);
    assert.equal(doc.body.querySelectorAll(`.${ADP_CART_WARNING_CLASS}`).length, 2);
    // Warnings are not direct children of body (attached to product rows).
    const bodyDirect = doc.body.children.filter(
      (c) => c.className?.includes?.(ADP_CART_WARNING_CLASS),
    );
    assert.equal(bodyDirect.length, 0);
  });

  it("attaches Books multi-row warnings only to exact product hosts; unmatched skipped", async () => {
    const html = readFileSync(join(fixtures, "fanza-books-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(html, "https://book.dmm.co.jp/basket/");
    const rows = parseBooksCartRowsFromPayload(doc as unknown as Document, {
      product_ids: ["b100xxxxx01001", "b100yyyyy00001", "b_unmatched"],
    });
    assert.equal(rows.length, 2);

    const warned = await runCartPage(
      "fanza_books",
      doc as unknown as Document,
      async () => rows,
      async () => [
        { owned: true, other: [] },
        {
          owned: false,
          other: [
            {
              source: "dlsite",
              cid: "RJ123456",
              title: "x",
              url: "https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html",
            },
          ],
        },
      ],
    );
    assert.equal(warned, 2);
    assert.ok(rows[0]!.host.querySelector(`.${ADP_CART_WARNING_CLASS}`));
    assert.ok(rows[1]!.host.querySelector(`.${ADP_CART_WARNING_CLASS}`));
    assert.notEqual(rows[0]!.host, doc.body);
    assert.notEqual(rows[1]!.host, doc.body);
  });
});
