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
import { MockDocument } from "../../test/mock-document.js";
import { MSG_DISCOVERY_RESULT } from "../../../messages.js";
import { ADP_GATE_BANNER_ID, ADP_GATED_ATTR, isPurchaseGateMounted } from "../../purchase-gate/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, "fixtures");

describe("cart runner", () => {
  it("gates a DLsite cart after comparison confirms an owned FANZA counterpart", async () => {
    const html = readFileSync(join(fixtures, "dlsite-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(html, "https://www.dlsite.com/maniax/cart");
    const store = new Map<string, string>();
    const listeners = new Set<(message: unknown) => boolean>();
    const sentMessages: Array<{ type?: string }> = [];
    const previousChrome = (globalThis as { chrome?: unknown }).chrome;

    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        sendMessage: async (message: { type?: string }) => {
          sentMessages.push(message);
          if (message.type === "adp:discovery-start") {
            return { ok: true, sessionId: "cart-session-owned-fanza" };
          }
          if (message.type === "adp:lookup") {
            return { ok: true, results: [{ owned: true, other: [], possible: [] }] };
          }
          return undefined;
        },
        onMessage: {
          addListener: (listener: (message: unknown) => boolean) => listeners.add(listener),
          removeListener: (listener: (message: unknown) => boolean) => listeners.delete(listener),
        },
      },
    };

    try {
      const warned = await runCartPage(
        "dlsite",
        doc as unknown as Document,
        parseDlsiteCartRows,
        async () => [
          {
            owned: false,
            other: [],
            possible: [
              {
                source: "fanza_doujin",
                cid: "d_375259",
                title: "FANZA表記の作品名",
                url: "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_375259/",
              },
            ],
          },
          { owned: false, other: [] },
        ],
        {
          gateStore: {
            getItem: (key) => store.get(key) ?? null,
            setItem: (key, value) => store.set(key, value),
            removeItem: (key) => store.delete(key),
          },
        },
      );

      assert.equal(warned, 0, "fuzzy-only lookup must not gate before explicit comparison");
      assert.equal(isPurchaseGateMounted(doc as unknown as Document), false);
      const comparison = doc.body.querySelector(
        '[data-adp-cart-price-comparison="RJ123456"]',
      ) as HTMLElement;
      assert.ok(comparison);
      const button = comparison.querySelector(
        ".adp-cart-price-comparison__button",
      ) as { onclick?: (event?: { preventDefault?: () => void; stopPropagation?: () => void }) => void };
      assert.ok(button?.onclick);
      button.onclick({});

      const listener = [...listeners][0];
      assert.ok(listener);
      const sessionId = (sentMessages[0] as { sessionId?: string }).sessionId;
      assert.ok(sessionId);
      listener({
        type: MSG_DISCOVERY_RESULT,
        sessionId,
        ok: true,
        kind: "compare",
        targetSource: "fanza_doujin",
        targetCid: "d_375259",
        targetTitle: "FANZA表記の作品名",
        targetMaker: "サークル名",
        targetProductUrl: "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_375259/",
        originTiers: { regular: null, sale: null, coupon: null },
        targetTiers: { regular: null, sale: null, coupon: null },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.deepEqual(
        sentMessages.map((message) => message.type),
        ["adp:discovery-start", "adp:lookup"],
      );
      assert.equal(isPurchaseGateMounted(doc as unknown as Document), true);
      assert.match(doc.getElementById(ADP_GATE_BANNER_ID)?.textContent ?? "", /確定重複/);
      const cta = doc.body.querySelector(
        '[data-adp-purchase-cta="cart-progress"]',
      ) as HTMLElement;
      assert.equal(cta.getAttribute(ADP_GATED_ATTR), "1");
      assert.ok(
        doc.body.querySelector(
          '[data-adp-cart-warning="RJ123456"]',
        ),
        "the compared cart row must receive the duplicate warning",
      );
    } finally {
      (globalThis as { chrome?: unknown }).chrome = previousChrome;
    }
  });

  it("warns on same-store and cross-store duplicates without auto-delete", async () => {
    const html = readFileSync(join(fixtures, "dlsite-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(html, "https://www.dlsite.com/maniax/cart");
    const fetchCalls: string[] = [];

    // Fixture has layout-dup of RJ123456 → parser yields 2 unique rows.
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

  it("mounted delete/undo never leak unhandled rejection; reject/non-ok skip toast", async () => {
    const html = readFileSync(join(fixtures, "dlsite-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(html, "https://www.dlsite.com/maniax/cart");
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    const originalFetch = globalThis.fetch;
    let mode: "reject" | "nonok" | "ok" = "reject";
    globalThis.fetch = (async () => {
      if (mode === "reject") throw new Error("network reject");
      if (mode === "nonok") return { ok: false, status: 500 } as Response;
      return { ok: true } as Response;
    }) as typeof fetch;

    try {
      await runCartPage(
        "dlsite",
        doc as unknown as Document,
        parseDlsiteCartRows,
        async () => [{ owned: true, other: [] }],
      );

      const warnings = doc.body.querySelectorAll(`.${ADP_CART_WARNING_CLASS}`);
      assert.equal(warnings.length, 1, "deduped single warning for RJ123456");
      const deleteButton = warnings[0]!.querySelector(".adp-cart-warning__delete") as {
        onclick: (() => void) | null;
      };
      assert.ok(deleteButton?.onclick);

      // Reject path: no toast, warning stays, zero unhandled.
      mode = "reject";
      deleteButton.onclick?.();
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(doc.getElementById(ADP_CART_TOAST_ID), null);
      assert.equal(
        doc.body.querySelectorAll(`.${ADP_CART_WARNING_CLASS}`).length,
        1,
        "warning remains retryable after reject",
      );

      // Non-ok path: still no toast, control stays.
      mode = "nonok";
      deleteButton.onclick?.();
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(doc.getElementById(ADP_CART_TOAST_ID), null);
      assert.equal(doc.body.querySelectorAll(`.${ADP_CART_WARNING_CLASS}`).length, 1);

      // Success then undo with restore reject: no unhandled.
      mode = "ok";
      deleteButton.onclick?.();
      await new Promise((r) => setTimeout(r, 10));
      const toast = doc.getElementById(ADP_CART_TOAST_ID);
      assert.ok(toast, "success toast after ok remove");
      mode = "reject";
      const undo = toast!.querySelector(".adp-cart-toast__undo") as {
        onclick: (() => void) | null;
      };
      undo.onclick?.();
      await new Promise((r) => setTimeout(r, 10));

      assert.equal(unhandled.length, 0, "zero unhandledRejection from delete/undo");
    } finally {
      process.off("unhandledRejection", onUnhandled);
      globalThis.fetch = originalFetch;
    }
  });

  it("invalid workno on mounted delete click yields fetch 0", async () => {
    const html = readFileSync(join(fixtures, "dlsite-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(html, "https://www.dlsite.com/maniax/cart");
    const urls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return { ok: true } as Response;
    }) as typeof fetch;

    try {
      // Mock document class selectors are limited; locate cart_list_item by tag scan.
      const host = Array.from(
        (doc as unknown as Document).querySelectorAll("li"),
      ).find((el) => el.className.split(/\s+/).includes("cart_list_item")) as
        | HTMLElement
        | undefined;
      assert.ok(host);
      const { mountCartWarning } = await import("../warning.js");
      const { createCartDeleter } = await import("../../../cart-deleter/index.js");
      const deleter = createCartDeleter({
        source: "dlsite",
        doc: doc as unknown as Document,
      });
      mountCartWarning(
        doc as unknown as Document,
        {
          cid: "../../api/sensitive",
          title: "evil",
          maker: null,
          host,
        },
        { owned: true, other: [] },
        deleter,
      );
      const deleteButton = host.querySelector(".adp-cart-warning__delete") as {
        onclick: (() => void) | null;
      };
      assert.ok(deleteButton?.onclick);
      deleteButton.onclick?.();
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(urls.length, 0, "invalid cid must not fetch through click path");
      assert.equal(doc.getElementById(ADP_CART_TOAST_ID), null);
      assert.ok(
        host.querySelector(`.${ADP_CART_WARNING_CLASS}`),
        "warning remains retryable",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("DLsite duplicated cart layout yields one warning/delete control only", async () => {
    const html = readFileSync(join(fixtures, "dlsite-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(html, "https://www.dlsite.com/maniax/cart");
    const lookupCalls: unknown[] = [];
    const warned = await runCartPage(
      "dlsite",
      doc as unknown as Document,
      parseDlsiteCartRows,
      async (items) => {
        lookupCalls.push(items);
        return items.map(() => ({ owned: true, other: [] }));
      },
    );
    // Two unique worknos (RJ123456 deduped + RJ999999); both owned → 2 warnings.
    assert.equal(warned, 2);
    assert.equal(lookupCalls.length, 1);
    const items = lookupCalls[0] as Array<{ cid: string }>;
    assert.equal(items.length, 2);
    assert.deepEqual(
      items.map((i) => i.cid),
      ["RJ123456", "RJ999999"],
    );
    const warnings = doc.body.querySelectorAll(`.${ADP_CART_WARNING_CLASS}`);
    assert.equal(warnings.length, 2);
    const deletes = doc.body.querySelectorAll(".adp-cart-warning__delete");
    assert.equal(deletes.length, 2);
    // Exactly one warning for the duplicated workno host set.
    const dupWarnings = Array.from(warnings).filter(
      (w) => w.getAttribute("data-adp-cart-warning") === "RJ123456",
    );
    assert.equal(dupWarnings.length, 1);
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

  it("mounts FANZA comparison on a cart row whose host is not a div", async () => {
    const doc = new MockDocument();
    doc.location.href = "https://www.dmm.co.jp/dc/doujin/-/basket/";
    const host = doc.createElement("li");
    host.className = "basket-item";
    host.setAttribute("data-content-id", "d_900001");
    doc.body.appendChild(host);

    // React can render the row after the basket API has already returned. The
    // old parser only scanned div[data-content-id], so this was invisible to
    // the comparison mount even though the live API had the item.
    const result = await runCartPage(
      "fanza_doujin",
      doc as unknown as Document,
      async () => [],
      async () => [],
      {
        loadCartCids: async () => [
          {
            cid: "d_900001",
            title: "サンプル同人作品",
            maker: "サークル名",
          },
        ],
      },
    );

    assert.equal(result, 0);
    assert.ok(
      host.querySelector(".adp-cart-price-comparison__button"),
      "comparison must mount on an exact non-div product row host",
    );
  });

  it("retries FANZA comparison after React hydrates the basket row", async () => {
    const doc = new MockDocument();
    doc.location.href = "https://www.dmm.co.jp/dc/doujin/-/basket/";
    let notify: (() => void) | null = null;

    await runCartPage(
      "fanza_doujin",
      doc as unknown as Document,
      async () => [],
      async () => [],
      {
        loadCartCids: async () => [
          {
            cid: "d_900001",
            title: "サンプル同人作品",
            maker: "サークル名",
          },
        ],
        observeCartRows: (_doc, onChange) => {
          notify = onChange;
          return () => {
            notify = null;
          };
        },
      },
    );

    assert.ok(notify, "row observer must remain armed while no host exists");
    const host = doc.createElement("div");
    host.className = "basket-item";
    host.setAttribute("data-content-id", "d_900001");
    doc.body.appendChild(host);
    notify?.();

    assert.ok(host.querySelector(".adp-cart-price-comparison__button"));
    assert.equal(notify, null, "observer must disconnect after the row is mounted");
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

  it("mounts warnings for quote/CSS-meta cids without throw and without cross-row match", async () => {
    const html = readFileSync(join(fixtures, "dlsite-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(html, "https://www.dlsite.com/maniax/cart");
    const { mountCartWarning } = await import("../warning.js");
    const { createCartDeleter } = await import("../../../cart-deleter/index.js");

    // CSS/meta-hostile cids: quotes, attribute closers, combinators.
    const cidA = `evil"][data-x="1`;
    const cidB = `other" .adp-cart-warning`;
    const hostA = doc.createElement("div");
    const hostB = doc.createElement("div");
    doc.body.appendChild(hostA);
    doc.body.appendChild(hostB);

    const deleter = createCartDeleter({
      source: "dlsite",
      doc: doc as unknown as Document,
      fetchFn: async () => ({ ok: true }) as Response,
    });
    const hit = { owned: true, other: [] as [] };

    assert.doesNotThrow(() => {
      mountCartWarning(
        doc as unknown as Document,
        { cid: cidA, title: "A", maker: null, host: hostA as unknown as HTMLElement },
        hit,
        deleter,
      );
      mountCartWarning(
        doc as unknown as Document,
        { cid: cidB, title: "B", maker: null, host: hostB as unknown as HTMLElement },
        hit,
        deleter,
      );
      // Second mount same cid must be no-op (duplicate guard) without throw.
      mountCartWarning(
        doc as unknown as Document,
        { cid: cidA, title: "A", maker: null, host: hostA as unknown as HTMLElement },
        hit,
        deleter,
      );
    });

    const warnA = hostA.querySelectorAll(`.${ADP_CART_WARNING_CLASS}`);
    const warnB = hostB.querySelectorAll(`.${ADP_CART_WARNING_CLASS}`);
    assert.equal(warnA.length, 1, "exactly one warning on host A");
    assert.equal(warnB.length, 1, "exactly one warning on host B");
    assert.equal(warnA[0]!.getAttribute("data-adp-cart-warning"), cidA);
    assert.equal(warnB[0]!.getAttribute("data-adp-cart-warning"), cidB);
    // No cross-row mis-match: A host must not claim B's cid.
    assert.notEqual(warnA[0]!.getAttribute("data-adp-cart-warning"), cidB);
    assert.notEqual(warnB[0]!.getAttribute("data-adp-cart-warning"), cidA);
  });
});
