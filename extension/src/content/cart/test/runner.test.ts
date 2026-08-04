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
      pathname: "/maniax/cart",
      context: {},
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
});
