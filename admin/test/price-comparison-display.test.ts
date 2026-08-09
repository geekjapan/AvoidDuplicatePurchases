import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Window } from "happy-dom";

function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

function installDom(): Window {
  const window = new Window({
    url: "http://127.0.0.1:41321/price-comparison",
  });
  defineGlobal("window", window);
  defineGlobal("self", window);
  defineGlobal("document", window.document);
  defineGlobal("HTMLElement", window.HTMLElement);
  defineGlobal("HTMLInputElement", window.HTMLInputElement);
  defineGlobal("HTMLButtonElement", window.HTMLButtonElement);
  defineGlobal("HTMLSelectElement", window.HTMLSelectElement);
  defineGlobal("HTMLAnchorElement", window.HTMLAnchorElement);
  defineGlobal("HTMLImageElement", window.HTMLImageElement);
  defineGlobal("Node", window.Node);
  defineGlobal("Event", window.Event);
  defineGlobal("MouseEvent", window.MouseEvent);
  defineGlobal("CustomEvent", window.CustomEvent);
  defineGlobal("location", window.location);
  defineGlobal("history", window.history);
  defineGlobal("navigator", window.navigator);
  defineGlobal("fetch", window.fetch.bind(window));
  window.document.body.innerHTML = '<div id="app"></div>';
  return window;
}

function baseListing(overrides: Record<string, unknown>) {
  return {
    workIdLocked: false,
    maker: "合成サークル",
    seriesId: null,
    imageUrl: null,
    imageProvenance: null,
    productUrl: null,
    productUrlProvenance: null,
    purchasedAt: null,
    purchasedAtPrecision: "unknown",
    purchasePrice: null,
    currentPrice: null,
    priceObservation: null,
    ...overrides,
  };
}

describe("price comparison display (#59)", () => {
  let window: Window | undefined;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    defineGlobal("fetch", originalFetch);
    window?.close();
    window = undefined;
  });

  it("groups FANZA/DLsite same-work rows, shows three tiers + observedAt, excludes other sources", async () => {
    window = installDom();

    const payload = {
      listings: [
        baseListing({
          id: 1,
          source: "dlsite",
          cid: "RJ000059",
          workId: 59,
          title: "合成・同一作品 DLsite",
          priceObservation: {
            regular: {
              amountMinor: 1100,
              currency: "JPY",
              taxStatus: "included",
            },
            sale: {
              amountMinor: 880,
              currency: "JPY",
              taxStatus: "included",
            },
            coupon: {
              amountMinor: 792,
              currency: "JPY",
              taxStatus: "included",
            },
            observedAt: "2026-08-09T10:00:00.000Z",
          },
        }),
        baseListing({
          id: 2,
          source: "fanza_doujin",
          cid: "d_syn_59",
          workId: 59,
          title: "合成・同一作品 FANZA同人",
          priceObservation: {
            regular: {
              amountMinor: 1200,
              currency: "JPY",
              taxStatus: "included",
            },
            sale: {
              amountMinor: 600,
              currency: "JPY",
              taxStatus: "included",
            },
            coupon: null,
            observedAt: "2026-08-09T11:00:00.000Z",
          },
        }),
        baseListing({
          id: 3,
          source: "fanza_books",
          cid: "b_syn_59",
          workId: 59,
          title: "合成・同一作品 FANZAブックス",
          priceObservation: {
            regular: {
              amountMinor: 1000,
              currency: "JPY",
              taxStatus: "included",
            },
            sale: null,
            coupon: null,
            observedAt: "2026-08-09T09:30:00.000Z",
          },
        }),
        // Excluded sources must not appear as comparison rows.
        baseListing({
          id: 4,
          source: "fanza_video",
          cid: "v_syn_59",
          workId: 59,
          title: "除外・動画",
          priceObservation: {
            regular: {
              amountMinor: 100,
              currency: "JPY",
              taxStatus: "included",
            },
            sale: null,
            coupon: null,
            observedAt: "2026-08-09T08:00:00.000Z",
          },
        }),
        baseListing({
          id: 5,
          source: "fanza_dlsoft",
          cid: "pc_syn_59",
          workId: 59,
          title: "除外・dlsoft",
        }),
        // Separate work group
        baseListing({
          id: 6,
          source: "dlsite",
          cid: "RJ000060",
          workId: 60,
          title: "別 work",
          priceObservation: null,
        }),
      ],
      total: 6,
    };

    defineGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      assert.match(url, /\/api\/listings/);
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const { renderPriceComparison } = await import(
      "../src/pages/price-comparison.ts"
    );
    const root = document.createElement("div");
    document.body.append(root);
    await renderPriceComparison(root);

    const boundary = root.querySelector(
      '[data-testid="price-comparison-boundary"]',
    );
    assert.ok(boundary);
    assert.match(boundary.textContent ?? "", /読み取り専用|priceObservation/);

    const groups = [
      ...root.querySelectorAll('[data-testid="price-comparison-work-group"]'),
    ];
    assert.equal(groups.length, 2);

    const work59 = root.querySelector(
      '[data-testid="price-comparison-work-group"][data-work-id="59"]',
    );
    assert.ok(work59);
    const rows59 = [
      ...work59.querySelectorAll(
        '[data-testid="price-comparison-listing-row"]',
      ),
    ];
    assert.equal(rows59.length, 3);
    const sources = rows59.map((r) => r.getAttribute("data-source")).sort();
    assert.deepEqual(sources, ["dlsite", "fanza_books", "fanza_doujin"]);
    assert.equal(
      work59.querySelector('[data-source="fanza_video"]'),
      null,
    );
    assert.equal(
      work59.querySelector('[data-source="fanza_dlsoft"]'),
      null,
    );

    // Identity keeps source/cid visible (not brand-only).
    const identities = [
      ...work59.querySelectorAll(
        '[data-testid="price-comparison-source-cid"]',
      ),
    ].map((n) => n.textContent ?? "");
    assert.ok(identities.some((t) => t.includes("dlsite / RJ000059")));
    assert.ok(identities.some((t) => t.includes("fanza_doujin / d_syn_59")));

    // Three tiers + observedAt for DLsite row.
    const dlsiteRow = work59.querySelector(
      '[data-testid="price-comparison-listing-row"][data-source="dlsite"]',
    );
    assert.ok(dlsiteRow);
    assert.match(
      dlsiteRow.querySelector('[data-testid="price-comparison-tier-regular"]')
        ?.textContent ?? "",
      /JPY 1100/,
    );
    assert.match(
      dlsiteRow.querySelector('[data-testid="price-comparison-tier-sale"]')
        ?.textContent ?? "",
      /JPY 880/,
    );
    assert.match(
      dlsiteRow.querySelector('[data-testid="price-comparison-tier-coupon"]')
        ?.textContent ?? "",
      /JPY 792/,
    );
    assert.equal(
      dlsiteRow.querySelector('[data-testid="price-comparison-observed-at"]')
        ?.textContent,
      "2026-08-09T10:00:00.000Z",
    );

    // Missing tier is 未取得, not inferred from another tier.
    const booksRow = work59.querySelector(
      '[data-testid="price-comparison-listing-row"][data-source="fanza_books"]',
    );
    assert.ok(booksRow);
    const saleCell = booksRow.querySelector(
      '[data-testid="price-comparison-tier-sale"]',
    );
    assert.equal(saleCell?.getAttribute("data-missing"), "true");
    assert.equal(saleCell?.textContent, "未取得");
    const couponCell = booksRow.querySelector(
      '[data-testid="price-comparison-tier-coupon"]',
    );
    assert.equal(couponCell?.textContent, "未取得");

    // Comparable sale tier: fanza_doujin 600 is lowest among dlsite+doujin.
    const saleSummary = work59.querySelector(
      '[data-testid="price-comparison-summary-sale"]',
    );
    assert.equal(saleSummary?.getAttribute("data-comparison-status"), "lowest");
    assert.match(saleSummary?.textContent ?? "", /最安/);
    assert.match(saleSummary?.textContent ?? "", /fanza_doujin\/d_syn_59/);
    assert.match(saleSummary?.textContent ?? "", /600/);

    // Coupon: only one value → insufficient, not ranked across stores.
    const couponSummary = work59.querySelector(
      '[data-testid="price-comparison-summary-coupon"]',
    );
    assert.equal(
      couponSummary?.getAttribute("data-comparison-status"),
      "insufficient",
    );

    // Null observation listing still shows 未取得 for all tiers.
    const work60 = root.querySelector(
      '[data-testid="price-comparison-work-group"][data-work-id="60"]',
    );
    assert.ok(work60);
    const nullRow = work60.querySelector(
      '[data-testid="price-comparison-listing-row"]',
    );
    assert.equal(
      nullRow?.querySelector('[data-testid="price-comparison-tier-regular"]')
        ?.textContent,
      "未取得",
    );
    assert.equal(
      nullRow?.querySelector('[data-testid="price-comparison-observed-at"]')
        ?.textContent,
      "未取得",
    );

    const status = root.querySelector(
      '[data-testid="price-comparison-status"]',
    );
    assert.match(status?.textContent ?? "", /除外ソース/);
  });

  it("marks taxStatus mismatch as 比較不可 and does not rank", async () => {
    window = installDom();

    // Persisted priceObservation is JPY-only in schema; currency mismatch is
    // covered by pure unit tests. Display path covers taxStatus fail-closed.
    const payload = {
      listings: [
        baseListing({
          id: 1,
          source: "dlsite",
          cid: "RJ_TAX_A",
          workId: 100,
          title: "税込側",
          priceObservation: {
            regular: {
              amountMinor: 800,
              currency: "JPY",
              taxStatus: "included",
            },
            sale: {
              amountMinor: 500,
              currency: "JPY",
              taxStatus: "included",
            },
            coupon: null,
            observedAt: "2026-08-09T12:00:00.000Z",
          },
        }),
        baseListing({
          id: 2,
          source: "fanza_doujin",
          cid: "d_TAX_B",
          workId: 100,
          title: "税別側",
          priceObservation: {
            regular: {
              amountMinor: 700,
              currency: "JPY",
              taxStatus: "excluded",
            },
            sale: {
              amountMinor: 400,
              currency: "JPY",
              taxStatus: "unknown",
            },
            coupon: null,
            observedAt: "2026-08-09T12:05:00.000Z",
          },
        }),
      ],
      total: 2,
    };

    defineGlobal("fetch", async () => {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const { renderPriceComparison } = await import(
      "../src/pages/price-comparison.ts"
    );
    const root = document.createElement("div");
    document.body.append(root);
    await renderPriceComparison(root);

    const regular = root.querySelector(
      '[data-testid="price-comparison-summary-regular"]',
    );
    assert.equal(regular?.getAttribute("data-comparison-status"), "incomparable");
    assert.match(regular?.textContent ?? "", /比較不可/);
    assert.doesNotMatch(regular?.textContent ?? "", /最安/);

    const sale = root.querySelector(
      '[data-testid="price-comparison-summary-sale"]',
    );
    assert.equal(sale?.getAttribute("data-comparison-status"), "incomparable");
    assert.match(sale?.textContent ?? "", /比較不可/);
  });

  it("does not invent cross-work aggregation or title matching", async () => {
    window = installDom();

    const payload = {
      listings: [
        baseListing({
          id: 1,
          source: "dlsite",
          cid: "RJ_A",
          workId: 1,
          title: "同じタイトル",
          priceObservation: {
            regular: {
              amountMinor: 1000,
              currency: "JPY",
              taxStatus: "included",
            },
            sale: null,
            coupon: null,
            observedAt: "2026-08-09T01:00:00.000Z",
          },
        }),
        baseListing({
          id: 2,
          source: "fanza_doujin",
          cid: "d_B",
          workId: 2,
          title: "同じタイトル",
          priceObservation: {
            regular: {
              amountMinor: 500,
              currency: "JPY",
              taxStatus: "included",
            },
            sale: null,
            coupon: null,
            observedAt: "2026-08-09T01:00:00.000Z",
          },
        }),
      ],
      total: 2,
    };

    defineGlobal("fetch", async () => {
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const { renderPriceComparison } = await import(
      "../src/pages/price-comparison.ts"
    );
    const root = document.createElement("div");
    document.body.append(root);
    await renderPriceComparison(root);

    const groups = root.querySelectorAll(
      '[data-testid="price-comparison-work-group"]',
    );
    assert.equal(groups.length, 2);
    // Each work has only one listing → regular summary insufficient, not cross-title lowest.
    for (const g of groups) {
      const summary = g.querySelector(
        '[data-testid="price-comparison-summary-regular"]',
      );
      assert.equal(
        summary?.getAttribute("data-comparison-status"),
        "insufficient",
      );
    }
  });
});
