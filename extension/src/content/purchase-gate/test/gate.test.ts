import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { buildCartFixtureDocument } from "../../cart/test/build-cart-fixture.js";
import { parseDlsiteCartRows } from "../../cart/parse-dlsite.js";
import { runCartPage } from "../../cart/runner.js";
import { ADP_CART_WARNING_CLASS } from "../../cart/warning.js";
import { runProductPageWithLookup } from "../../product-runner.js";
import { parseFixtureDocument } from "../../test/mock-document.js";
import {
  ADP_GATE_BANNER_ID,
  ADP_GATED_ATTR,
  applyConfirmedDuplicateGate,
  isPurchaseGateMounted,
  mountPurchaseGate,
  readConfirmedDuplicateCids,
  runPurchaseProgressPage,
  unmountPurchaseGate,
  writeConfirmedDuplicateCids,
  type GateStateStore,
} from "../index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const productFixtures = join(__dirname, "../../test/fixtures");
const cartFixtures = join(__dirname, "../../cart/test/fixtures");

function memoryStore(): GateStateStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

describe("fail-closed purchase gate (#57)", () => {
  it("gates cart purchase when confirmed owned row remains; reason visible", async () => {
    const html = readFileSync(join(cartFixtures, "dlsite-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(html, "https://www.dlsite.com/maniax/cart");
    const store = memoryStore();

    const warned = await runCartPage(
      "dlsite",
      doc as unknown as Document,
      parseDlsiteCartRows,
      async () => [
        { owned: true, other: [] },
        { owned: false, other: [] },
      ],
      { gateStore: store },
    );

    assert.equal(warned, 1);
    assert.equal(doc.body.querySelectorAll(`.${ADP_CART_WARNING_CLASS}`).length, 1);
    assert.equal(isPurchaseGateMounted(doc as unknown as Document), true);
    const banner = doc.getElementById(ADP_GATE_BANNER_ID);
    assert.ok(banner);
    assert.match(banner!.textContent ?? "", /確定重複/);
    const cta = doc.body.querySelector('[data-adp-purchase-cta="cart-progress"]') as {
      getAttribute: (n: string) => string | null;
    };
    assert.equal(cta.getAttribute(ADP_GATED_ATTR), "1");
    assert.deepEqual(readConfirmedDuplicateCids("dlsite", store), ["RJ123456"]);
  });

  it("ungates cart after confirmed duplicate is deleted (no remaining confirmed)", async () => {
    const html = readFileSync(join(cartFixtures, "dlsite-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(html, "https://www.dlsite.com/maniax/cart");
    const store = memoryStore();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: true }) as Response) as typeof fetch;

    try {
      await runCartPage(
        "dlsite",
        doc as unknown as Document,
        parseDlsiteCartRows,
        async () => [
          { owned: true, other: [] },
          { owned: false, other: [] },
        ],
        { gateStore: store },
      );
      assert.equal(isPurchaseGateMounted(doc as unknown as Document), true);

      const deleteButton = doc.body.querySelector(".adp-cart-warning__delete") as {
        onclick: (() => void) | null;
      };
      assert.ok(deleteButton?.onclick);
      deleteButton.onclick?.();
      await new Promise((r) => setTimeout(r, 20));

      assert.equal(isPurchaseGateMounted(doc as unknown as Document), false);
      assert.deepEqual(readConfirmedDuplicateCids("dlsite", store), []);
      const cta = doc.body.querySelector('[data-adp-purchase-cta="cart-progress"]') as {
        getAttribute: (n: string) => string | null;
      };
      assert.equal(cta.getAttribute(ADP_GATED_ATTR), null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("gates cart for cross-store other the same as owned", async () => {
    const html = readFileSync(join(cartFixtures, "dlsite-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(html, "https://www.dlsite.com/maniax/cart");
    const store = memoryStore();

    await runCartPage(
      "dlsite",
      doc as unknown as Document,
      parseDlsiteCartRows,
      async () => [
        {
          owned: false,
          other: [
            {
              source: "fanza_doujin",
              cid: "d_900001",
              title: "x",
              url: "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_900001/",
            },
          ],
        },
        { owned: false, other: [] },
      ],
      { gateStore: store },
    );

    assert.equal(isPurchaseGateMounted(doc as unknown as Document), true);
    assert.match(
      doc.getElementById(ADP_GATE_BANNER_ID)!.textContent ?? "",
      /確定重複/,
    );
  });

  it("does not gate cart when only possible candidates are present", async () => {
    const html = readFileSync(join(cartFixtures, "dlsite-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(html, "https://www.dlsite.com/maniax/cart");
    const store = memoryStore();

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
              cid: "d_900001",
              title: "似た作品",
              url: "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_900001/",
            },
          ],
        },
        { owned: false, other: [] },
      ],
      { gateStore: store },
    );

    assert.equal(warned, 0);
    assert.equal(isPurchaseGateMounted(doc as unknown as Document), false);
    assert.equal(doc.body.querySelectorAll(`.${ADP_CART_WARNING_CLASS}`).length, 0);
    assert.deepEqual(readConfirmedDuplicateCids("dlsite", store), []);
  });

  it("does not gate cart on lookup null (fail-open)", async () => {
    const html = readFileSync(join(cartFixtures, "dlsite-cart.html"), "utf8");
    const doc = buildCartFixtureDocument(html, "https://www.dlsite.com/maniax/cart");
    const store = memoryStore();

    const warned = await runCartPage(
      "dlsite",
      doc as unknown as Document,
      parseDlsiteCartRows,
      async () => null,
      { gateStore: store },
    );
    assert.equal(warned, 0);
    assert.equal(isPurchaseGateMounted(doc as unknown as Document), false);
  });

  it("product page: gates immediate-buy for owned, leaves cart-add enabled", async () => {
    const html = readFileSync(join(productFixtures, "dlsite-product.html"), "utf8");
    const doc = parseFixtureDocument(
      html,
      "https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html",
    );
    (doc.location as { pathname?: string }).pathname =
      "/maniax/work/=/product_id/RJ123456.html";

    await runProductPageWithLookup(
      "dlsite",
      doc as unknown as Document,
      async () => [{ owned: true, purchasedAt: "2023-12-30", other: [] }],
    );

    assert.equal(isPurchaseGateMounted(doc as unknown as Document), true);
    assert.match(
      doc.getElementById(ADP_GATE_BANNER_ID)!.textContent ?? "",
      /即購入/,
    );
    const immediate = doc.body.querySelector(
      '[data-adp-purchase-cta="immediate-buy"]',
    ) as { getAttribute: (n: string) => string | null };
    const cartAdd = doc.body.querySelector(
      '[data-adp-purchase-cta="cart-add"]',
    ) as { getAttribute: (n: string) => string | null };
    assert.ok(immediate, "immediate-buy CTA present in fixture");
    assert.equal(immediate.getAttribute(ADP_GATED_ATTR), "1");
    assert.equal(cartAdd.getAttribute(ADP_GATED_ATTR), null);
  });

  it("product page: possible-only does not gate immediate-buy", async () => {
    const html = readFileSync(join(productFixtures, "dlsite-product.html"), "utf8");
    const doc = parseFixtureDocument(
      html,
      "https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html",
    );
    (doc.location as { pathname?: string }).pathname =
      "/maniax/work/=/product_id/RJ123456.html";

    await runProductPageWithLookup(
      "dlsite",
      doc as unknown as Document,
      async () => [
        {
          owned: false,
          other: [],
          possible: [
            {
              source: "fanza_doujin",
              cid: "d_1",
              title: "候補",
              url: "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_1/",
            },
          ],
        },
      ],
    );

    assert.equal(isPurchaseGateMounted(doc as unknown as Document), false);
    const immediate = doc.body.querySelector(
      '[data-adp-purchase-cta="immediate-buy"]',
    ) as { getAttribute: (n: string) => string | null } | null;
    assert.equal(immediate?.getAttribute(ADP_GATED_ATTR) ?? null, null);
  });

  it("restores each CTA's pre-gate disabled and accessibility state", () => {
    const doc = parseFixtureDocument(
      `<!doctype html><body>
        <button type="button" data-adp-purchase-cta="purchase-progress" disabled="original-disabled" aria-disabled="false" tabindex="4">注文を確定する</button>
        <a href="/checkout" data-adp-purchase-cta="purchase-progress" aria-disabled="mixed" tabindex="7">支払いへ</a>
      </body>`,
      "https://book.dmm.co.jp/checkout",
    );
    const button = doc.body.querySelector(
      '[data-adp-purchase-cta="purchase-progress"]',
    ) as unknown as {
      disabled: boolean;
      getAttribute: (name: string) => string | null;
      setAttribute: (name: string, value: string) => void;
    };
    const anchor = doc.body.querySelectorAll(
      '[data-adp-purchase-cta="purchase-progress"]',
    )[1] as unknown as {
      getAttribute: (name: string) => string | null;
      setAttribute: (name: string, value: string) => void;
    };

    button.setAttribute("disabled", "original-disabled");
    button.setAttribute("aria-disabled", "false");
    button.setAttribute("tabindex", "4");
    anchor.setAttribute("aria-disabled", "mixed");
    anchor.setAttribute("tabindex", "7");
    assert.equal(button.disabled, true);
    assert.equal(mountPurchaseGate(doc as unknown as Document, "purchase_progress"), 2);
    assert.equal(button.getAttribute("aria-disabled"), "true");
    assert.equal(anchor.getAttribute("tabindex"), "-1");

    unmountPurchaseGate(doc as unknown as Document);
    assert.equal(button.disabled, true);
    assert.equal(button.getAttribute("disabled"), "original-disabled");
    assert.equal(button.getAttribute("aria-disabled"), "false");
    assert.equal(button.getAttribute("tabindex"), "4");
    assert.equal(anchor.getAttribute("aria-disabled"), "mixed");
    assert.equal(anchor.getAttribute("tabindex"), "7");
  });

  it("clears gated CTAs even when the banner was removed first", () => {
    const doc = parseFixtureDocument(
      `<!doctype html><body><button data-adp-purchase-cta="purchase-progress">注文を確定する</button></body>`,
      "https://book.dmm.co.jp/checkout",
    );
    const store = memoryStore();
    mountPurchaseGate(doc as unknown as Document, "purchase_progress");
    const banner = doc.getElementById(ADP_GATE_BANNER_ID);
    assert.ok(banner?.parentNode);
    banner?.parentNode?.removeChild(banner);

    applyConfirmedDuplicateGate(
      doc as unknown as Document,
      "fanza_books",
      "purchase_progress",
      [],
      store,
    );
    const cta = doc.body.querySelector(
      '[data-adp-purchase-cta="purchase-progress"]',
    );
    assert.equal(cta?.getAttribute(ADP_GATED_ATTR), null);
  });

  it("purchase-progress: gates from live cart cids when confirmed; fail-open on lookup null", async () => {
    const doc = parseFixtureDocument(
      `<!doctype html><body>
        <button type="button" data-adp-purchase-cta="purchase-progress">注文を確定する</button>
      </body>`,
      "https://www.dlsite.com/maniax/order",
    );
    (doc.location as { pathname?: string }).pathname = "/maniax/order";
    // Ensure CTA is present (parseFixtureDocument standalone button path).
    if (!doc.body.querySelector('[data-adp-purchase-cta="purchase-progress"]')) {
      const btn = doc.createElement("button");
      btn.setAttribute("type", "button");
      btn.setAttribute("data-adp-purchase-cta", "purchase-progress");
      btn.textContent = "注文を確定する";
      doc.body.appendChild(btn);
    }
    const store = memoryStore();

    const gated = await runPurchaseProgressPage("dlsite", doc as unknown as Document, {
      loadCartCids: async () => ["RJ123456"],
      lookup: async () => [{ owned: true, other: [] }],
      store,
    });
    assert.equal(gated.gated, true);
    assert.equal(isPurchaseGateMounted(doc as unknown as Document), true);
    assert.match(
      doc.getElementById(ADP_GATE_BANNER_ID)!.textContent ?? "",
      /カートに戻り|確定重複/,
    );

    // Clear and re-run with lookup null → fail-open.
    const doc2 = parseFixtureDocument(
      `<!doctype html><body>
        <button type="button" data-adp-purchase-cta="purchase-progress">注文を確定する</button>
      </body>`,
      "https://www.dlsite.com/maniax/order",
    );
    (doc2.location as { pathname?: string }).pathname = "/maniax/order";
    if (!doc2.body.querySelector('[data-adp-purchase-cta="purchase-progress"]')) {
      const btn = doc2.createElement("button");
      btn.setAttribute("type", "button");
      btn.setAttribute("data-adp-purchase-cta", "purchase-progress");
      btn.textContent = "注文を確定する";
      doc2.body.appendChild(btn);
    }
    const open = await runPurchaseProgressPage("dlsite", doc2 as unknown as Document, {
      loadCartCids: async () => ["RJ123456"],
      lookup: async () => null,
      store: memoryStore(),
    });
    assert.equal(open.gated, false);
    assert.equal(isPurchaseGateMounted(doc2 as unknown as Document), false);
  });

  it("purchase-progress: possible-only cart items do not gate", async () => {
    const doc = parseFixtureDocument(
      `<!doctype html><body></body>`,
      "https://book.dmm.co.jp/checkout",
    );
    (doc.location as { pathname?: string }).pathname = "/checkout";
    const btn = doc.createElement("button");
    btn.setAttribute("type", "button");
    btn.setAttribute("data-adp-purchase-cta", "purchase-progress");
    btn.textContent = "注文を確定する";
    doc.body.appendChild(btn);

    const result = await runPurchaseProgressPage(
      "fanza_books",
      doc as unknown as Document,
      {
        loadCartCids: async () => ["b100xxxxx01001"],
        lookup: async () => [
          {
            owned: false,
            other: [],
            possible: [
              {
                source: "dlsite",
                cid: "RJ1",
                title: "x",
                url: "https://www.dlsite.com/maniax/work/=/product_id/RJ1.html",
              },
            ],
          },
        ],
        store: memoryStore(),
      },
    );
    assert.equal(result.gated, false);
    assert.equal(isPurchaseGateMounted(doc as unknown as Document), false);
  });

  it("does not reuse session cids when the live basket is unavailable", async () => {
    const doc = parseFixtureDocument(
      `<!doctype html><body><button data-adp-purchase-cta="purchase-progress">注文を確定する</button></body>`,
      "https://book.dmm.co.jp/checkout",
    );
    const store = memoryStore();
    writeConfirmedDuplicateCids("fanza_books", ["b100xxxxx01001"], store);
    let lookupCalls = 0;

    const unavailable = await runPurchaseProgressPage(
      "fanza_books",
      doc as unknown as Document,
      {
        loadCartCids: async () => ({ status: "unavailable" as const }),
        lookup: async () => {
          lookupCalls += 1;
          return [{ owned: true, other: [] }];
        },
        store,
      },
    );

    assert.deepEqual(unavailable, { gated: false, ctaCount: 0 });
    assert.equal(lookupCalls, 0);
    assert.equal(isPurchaseGateMounted(doc as unknown as Document), false);

    const empty = await runPurchaseProgressPage(
      "fanza_books",
      doc as unknown as Document,
      {
        loadCartCids: async () => [],
        lookup: async () => [{ owned: true, other: [] }],
        store,
      },
    );
    assert.deepEqual(empty, { gated: false, ctaCount: 0 });
    assert.deepEqual(readConfirmedDuplicateCids("fanza_books", store), []);
  });
});
