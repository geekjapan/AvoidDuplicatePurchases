/**
 * Regression for #57 cart → purchase-progression gate on FANZA.
 *
 * Root-cause probes (must stay red until fixed):
 * 1) API response shape: basket payloads with extra live fields must still
 *    yield cids (strict .strict() rejection is the failure mode).
 * 2) Cart row DOM identification: when basket API has confirmed duplicates
 *    but product-row hosts are absent (SPA/timing), whole-cart gate must
 *    still apply and block レジに進む.
 * 3) Transition state: after leaving basket for an order/confirm surface,
 *    live cart cids must re-apply purchase_progress gate (banner + CTA).
 *
 * Fixtures use only synthetic/redacted cids and shapes — never private titles.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCartFixtureDocument } from "../../cart/test/build-cart-fixture.js";
import {
  fetchDoujinCartCids,
  parseDoujinCartCidsFromPayload,
  parseDoujinCartRowsFromPayload,
} from "../../cart/parse-doujin.js";
import { runCartPage } from "../../cart/runner.js";
import type { CartLookupItem } from "../../cart/types.js";
import { ADP_CART_WARNING_CLASS } from "../../cart/warning.js";
import { parseFixtureDocument } from "../../test/mock-document.js";
import {
  ADP_GATE_BANNER_ID,
  ADP_GATED_ATTR,
  isPurchaseGateMounted,
  readConfirmedDuplicateCids,
  runPurchaseProgressPage,
  type GateStateStore,
} from "../index.js";

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

/** Synthetic basket payload matching prototype shape + extra live fields. */
function syntheticDoujinBasketPayload(extraItemFields = true) {
  const item: Record<string, unknown> = {
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
  };
  if (extraItemFields) {
    // Live basket items historically grow unknown keys (README ellipsis).
    item.is_discount = true;
    item.shop_name = "doujin";
  }
  return {
    error_code: "0" as const,
    error_message: [] as unknown[],
    data: [item, {
      content_id: "d_100002",
      product_id: "d_100002",
      title: "未購入作品",
      maker_name: "別サークル",
      price: 100,
      fixed_price: 100,
      basket_price: 100,
    }],
    // Top-level extras also appear on evolving APIs.
    ...(extraItemFields ? { request_id: "synthetic-req" } : {}),
  };
}

describe("FANZA cart purchase-gate regression (#57)", () => {
  it("accepts basket payloads with extra fields (API shape probe)", async () => {
    const payload = syntheticDoujinBasketPayload(true);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => payload,
      }) as Response) as typeof fetch;
    try {
      const cids = await fetchDoujinCartCids();
      assert.ok(Array.isArray(cids), "extra fields must not mark basket unavailable");
      assert.deepEqual(cids, [
        {
          cid: "d_900001",
          title: "サンプル同人作品",
          maker: "サークル名",
        },
        {
          cid: "d_100002",
          title: "未購入作品",
          maker: "別サークル",
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("hostless live basket passes API title/maker to lookup and gates cross-store other", async () => {
    // Live shape: content_id + title + maker_name with no data-content-id host.
    const doc = buildCartFixtureDocument(
      `<!doctype html><html><body></body></html>`,
      "https://www.dmm.co.jp/dc/doujin/-/basket/",
    );
    const ctaBtn = doc.createElement("button");
    ctaBtn.setAttribute("type", "button");
    ctaBtn.textContent = "レジに進む";
    doc.body.appendChild(ctaBtn);

    const livePayload = {
      error_code: "0" as const,
      error_message: [] as unknown[],
      data: [
        {
          content_id: "d_411042",
          product_id: "d_411042",
          title: "サンプル同人作品",
          maker_name: "サークル名",
        },
      ],
    };
    const loaded = parseDoujinCartCidsFromPayload(livePayload);
    assert.ok(Array.isArray(loaded));
    assert.deepEqual(loaded, [
      {
        cid: "d_411042",
        title: "サンプル同人作品",
        maker: "サークル名",
      },
    ]);
    assert.equal(
      parseDoujinCartRowsFromPayload(doc as unknown as Document, livePayload).length,
      0,
      "fixture intentionally has no row hosts",
    );

    let seenItems: CartLookupItem[] = [];
    const warned = await runCartPage(
      "fanza_doujin",
      doc as unknown as Document,
      async () => [],
      async (items) => {
        seenItems = items;
        // Cross-store other only when title/maker reach lookup (not cid-only).
        return items.map((it) =>
          it.cid === "d_411042" &&
          it.title === "サンプル同人作品" &&
          it.maker === "サークル名"
            ? {
                owned: false,
                other: [
                  {
                    source: "dlsite",
                    cid: "RJ123456",
                    title: "サンプル同人作品",
                    url: "https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html",
                  },
                ],
              }
            : { owned: false, other: [] },
        );
      },
      {
        gateStore: memoryStore(),
        loadCartCids: async () => loaded,
      },
    );

    assert.equal(warned, 0, "no row host → no row warning");
    assert.equal(seenItems.length, 1);
    assert.deepEqual(seenItems[0], {
      source: "fanza_doujin",
      cid: "d_411042",
      title: "サンプル同人作品",
      maker: "サークル名",
    });
    assert.equal(
      isPurchaseGateMounted(doc as unknown as Document),
      true,
      "cross-store other with live metadata must gate basket CTA",
    );
    assert.equal(ctaBtn.getAttribute(ADP_GATED_ATTR), "1");
  });

  it("purchase-progress uses the same live metadata path for cross-store other", async () => {
    const doc = parseFixtureDocument(
      `<!doctype html><body>
        <button type="button">注文を確定する</button>
      </body>`,
      "https://www.dmm.co.jp/dc/doujin/-/order/",
    );
    (doc.location as { pathname?: string }).pathname = "/dc/doujin/-/order/";
    if (!doc.body.querySelector("button")) {
      const btn = doc.createElement("button");
      btn.setAttribute("type", "button");
      btn.textContent = "注文を確定する";
      doc.body.appendChild(btn);
    }

    let seenItems: CartLookupItem[] = [];
    const result = await runPurchaseProgressPage(
      "fanza_doujin",
      doc as unknown as Document,
      {
        loadCartCids: async () => [
          {
            cid: "d_411042",
            title: "サンプル同人作品",
            maker: "サークル名",
          },
        ],
        lookup: async (items) => {
          seenItems = items;
          return items.map((it) =>
            it.cid === "d_411042" &&
            it.title === "サンプル同人作品" &&
            it.maker === "サークル名"
              ? {
                  owned: false,
                  other: [
                    {
                      source: "dlsite",
                      cid: "RJ123456",
                      title: "サンプル同人作品",
                      url: "https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html",
                    },
                  ],
                }
              : { owned: false, other: [] },
          );
        },
        store: memoryStore(),
      },
    );

    assert.deepEqual(seenItems[0], {
      source: "fanza_doujin",
      cid: "d_411042",
      title: "サンプル同人作品",
      maker: "サークル名",
    });
    assert.equal(result.gated, true);
    assert.equal(isPurchaseGateMounted(doc as unknown as Document), true);
    assert.equal(
      (doc.body.querySelector("button") as { getAttribute: (n: string) => string | null })
        .getAttribute(ADP_GATED_ATTR),
      "1",
    );
  });

  it("gates FANZA basket with レジに進む even when row hosts are missing (DOM id probe)", async () => {
    // Empty body: no data-content-id hosts (SPA not yet hydrated / host attrs differ).
    const doc = buildCartFixtureDocument(
      `<!doctype html><html><body></body></html>`,
      "https://www.dmm.co.jp/dc/doujin/-/basket/",
    );
    // Mock fixture builder only materializes known cart-row shapes; append CTA.
    const ctaBtn = doc.createElement("button");
    ctaBtn.setAttribute("type", "button");
    ctaBtn.textContent = "レジに進む";
    doc.body.appendChild(ctaBtn);

    const store = memoryStore();
    const payload = syntheticDoujinBasketPayload(true);

    // parseRows path with hostless document → 0 CartRow hosts today.
    const hostlessRows = parseDoujinCartRowsFromPayload(
      doc as unknown as Document,
      payload,
    );
    assert.equal(hostlessRows.length, 0, "fixture intentionally has no row hosts");

    const warned = await runCartPage(
      "fanza_doujin",
      doc as unknown as Document,
      async () => hostlessRows,
      async (items) =>
        items.map((it) =>
          it.cid === "d_900001"
            ? { owned: true, other: [] }
            : { owned: false, other: [] },
        ),
      {
        gateStore: store,
        // Live cid loader must drive gate when DOM hosts are absent.
        loadCartCids: async () => ["d_900001", "d_100002"],
      },
    );

    // No row host → no row warning is acceptable; whole-cart gate is required.
    assert.equal(warned, 0);
    assert.equal(doc.body.querySelectorAll(`.${ADP_CART_WARNING_CLASS}`).length, 0);
    assert.equal(
      isPurchaseGateMounted(doc as unknown as Document),
      true,
      "confirmed duplicate in basket must gate purchase progression without row hosts",
    );
    const banner = doc.getElementById(ADP_GATE_BANNER_ID);
    assert.ok(banner);
    assert.match(banner!.textContent ?? "", /確定重複/);
    assert.equal(ctaBtn.getAttribute(ADP_GATED_ATTR), "1");
    assert.deepEqual(readConfirmedDuplicateCids("fanza_doujin", store), ["d_900001"]);
  });

  it("blocks mixed cart when one confirmed duplicate remains; possible-only stays open", async () => {
    const doc = buildCartFixtureDocument(
      `<!doctype html><html><body>
        <div data-content-id="d_900001" class="basket-item"><span class="title">A</span></div>
        <div data-content-id="d_100002" class="basket-item"><span class="title">B</span></div>
      </body></html>`,
      "https://www.dmm.co.jp/dc/doujin/-/basket/",
    );
    const cta = doc.createElement("button");
    cta.setAttribute("type", "button");
    cta.textContent = "レジに進む";
    doc.body.appendChild(cta);
    const store = memoryStore();
    const rows = parseDoujinCartRowsFromPayload(doc as unknown as Document, {
      error_code: "0",
      data: [
        { content_id: "d_900001", title: "A" },
        { content_id: "d_100002", title: "B" },
      ],
    });
    assert.equal(rows.length, 2);

    await runCartPage(
      "fanza_doujin",
      doc as unknown as Document,
      async () => rows,
      async () => [
        { owned: true, other: [] },
        { owned: false, other: [] },
      ],
      { gateStore: store, loadCartCids: async () => ["d_900001", "d_100002"] },
    );
    assert.equal(isPurchaseGateMounted(doc as unknown as Document), true);
    assert.equal(doc.body.querySelectorAll(`.${ADP_CART_WARNING_CLASS}`).length, 1);
    assert.equal(cta.getAttribute(ADP_GATED_ATTR), "1");

    // possible-only: no gate
    const doc2 = buildCartFixtureDocument(
      `<!doctype html><html><body>
        <div data-content-id="d_900001" class="basket-item"><span class="title">A</span></div>
      </body></html>`,
      "https://www.dmm.co.jp/dc/doujin/-/basket/",
    );
    const cta2 = doc2.createElement("button");
    cta2.setAttribute("type", "button");
    cta2.textContent = "レジに進む";
    doc2.body.appendChild(cta2);
    const open = await runCartPage(
      "fanza_doujin",
      doc2 as unknown as Document,
      async () =>
        parseDoujinCartRowsFromPayload(doc2 as unknown as Document, {
          error_code: "0",
          data: [{ content_id: "d_900001", title: "A" }],
        }),
      async () => [
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
      { gateStore: memoryStore(), loadCartCids: async () => ["d_900001"] },
    );
    assert.equal(open, 0);
    assert.equal(isPurchaseGateMounted(doc2 as unknown as Document), false);
    assert.equal(cta2.getAttribute(ADP_GATED_ATTR), null);
  });

  it("re-applies purchase_progress gate on order surface from live basket cids (transition probe)", async () => {
    const store = memoryStore();
    // Simulate post-basket order/confirm document (no cart row hosts).
    const doc = parseFixtureDocument(
      `<!doctype html><body>
        <button type="button">注文を確定する</button>
      </body>`,
      "https://www.dmm.co.jp/dc/doujin/-/order/",
    );
    (doc.location as { pathname?: string }).pathname = "/dc/doujin/-/order/";
    if (!doc.body.querySelector("button")) {
      const btn = doc.createElement("button");
      btn.setAttribute("type", "button");
      btn.textContent = "注文を確定する";
      doc.body.appendChild(btn);
    }

    const result = await runPurchaseProgressPage(
      "fanza_doujin",
      doc as unknown as Document,
      {
        loadCartCids: async () => ["d_900001", "d_100002"],
        lookup: async (items) =>
          items.map((it) =>
            it.cid === "d_900001"
              ? { owned: true, other: [] }
              : { owned: false, other: [] },
          ),
        store,
      },
    );
    assert.equal(result.gated, true);
    assert.equal(isPurchaseGateMounted(doc as unknown as Document), true);
    assert.match(
      doc.getElementById(ADP_GATE_BANNER_ID)!.textContent ?? "",
      /カートに戻り|確定重複/,
    );
    const cta = doc.body.querySelector("button") as {
      getAttribute: (n: string) => string | null;
    };
    assert.equal(cta.getAttribute(ADP_GATED_ATTR), "1");

    // Clearing confirmed cids (user removed duplicates from basket) lifts gate.
    const cleared = await runPurchaseProgressPage(
      "fanza_doujin",
      doc as unknown as Document,
      {
        loadCartCids: async () => ["d_100002"],
        lookup: async () => [{ owned: false, other: [] }],
        store,
      },
    );
    assert.equal(cleared.gated, false);
    assert.equal(isPurchaseGateMounted(doc as unknown as Document), false);

    // Basket unavailable → fail-open (no stale session reuse).
    writeOrEnsureStore(store);
    const unavailable = await runPurchaseProgressPage(
      "fanza_doujin",
      doc as unknown as Document,
      {
        loadCartCids: async () => ({ status: "unavailable" as const }),
        lookup: async () => [{ owned: true, other: [] }],
        store,
      },
    );
    assert.deepEqual(unavailable, { gated: false, ctaCount: 0 });
  });

  it("fail-open on lookup null and on loadCartCids unavailable at cart", async () => {
    const doc = buildCartFixtureDocument(
      `<!doctype html><html><body></body></html>`,
      "https://www.dmm.co.jp/dc/doujin/-/basket/",
    );
    const cta = doc.createElement("button");
    cta.setAttribute("type", "button");
    cta.textContent = "レジに進む";
    doc.body.appendChild(cta);

    const nullLookup = await runCartPage(
      "fanza_doujin",
      doc as unknown as Document,
      async () => [],
      async () => null,
      {
        gateStore: memoryStore(),
        loadCartCids: async () => ["d_900001"],
      },
    );
    assert.equal(nullLookup, 0);
    assert.equal(isPurchaseGateMounted(doc as unknown as Document), false);
    assert.equal(cta.getAttribute(ADP_GATED_ATTR), null);

    const unavailable = await runCartPage(
      "fanza_doujin",
      doc as unknown as Document,
      async () => [],
      async () => [{ owned: true, other: [] }],
      {
        gateStore: memoryStore(),
        loadCartCids: async () => ({ status: "unavailable" as const }),
      },
    );
    assert.equal(unavailable, 0);
    assert.equal(isPurchaseGateMounted(doc as unknown as Document), false);
  });
});

function writeOrEnsureStore(store: GateStateStore): void {
  // Keep confirmed cids in session so a buggy fallback would wrongly gate.
  store.setItem(
    "adp.confirmed_duplicate_cids.fanza_doujin",
    JSON.stringify(["d_900001"]),
  );
}
