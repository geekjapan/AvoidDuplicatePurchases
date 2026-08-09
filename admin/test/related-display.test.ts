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
  const window = new Window({ url: "http://127.0.0.1:41321/related" });
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

describe("related comparison display", () => {
  let window: Window | undefined;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    defineGlobal("fetch", originalFetch);
    window?.close();
    window = undefined;
  });

  it("keeps owned anchor separate and renders sale/stale/null price states", async () => {
    window = installDom();

    const listingsPayload = {
      listings: [
        {
          id: 1,
          source: "dlsite",
          cid: "RJ000001",
          workId: 1,
          workIdLocked: false,
          title: "合成アンカー作品",
          maker: "合成サークル",
          seriesId: null,
          imageUrl: null,
          imageProvenance: null,
          productUrl: "https://www.dlsite.com/maniax/work/=/product_id/RJ000001.html",
          productUrlProvenance: "verified_derived",
          purchasedAt: "2026-01-01T00:00:00.000Z",
          purchasedAtPrecision: "second",
          purchasePrice: null,
          currentPrice: null,
          priceObservation: null,
        },
      ],
      total: 1,
    };

    const relatedPayload = {
      anchor: { source: "dlsite", cid: "RJ000001" },
      generatedAt: "2026-08-09T12:00:00.000Z",
      items: [
        {
          product: {
            source: "dlsite",
            cid: "RJ900101",
            title: "合成・同メーカー関連作品",
            maker: "合成サークル",
            seriesId: null,
            imageUrl: null,
            productUrl: "https://www.dlsite.com/maniax/work/=/product_id/RJ900101.html",
          },
          relation: {
            evidence: [
              {
                kind: "maker",
                origin: "derived",
                anchorValue: "合成サークル",
                productValue: "合成サークル",
              },
            ],
          },
          ownership: {
            status: "not_confirmed",
            matchedBy: null,
            ownedBy: [],
          },
          price: {
            current: {
              amountMinor: 880,
              currency: "JPY",
              taxStatus: "included",
            },
            regular: {
              amountMinor: 1100,
              currency: "JPY",
              taxStatus: "included",
            },
            discountPercent: 20,
            saleEndsAt: "2026-08-20T15:00:00.000Z",
            observedAt: "2026-08-09T10:00:00.000Z",
            freshness: "fresh",
          },
        },
        {
          product: {
            source: "fanza_books",
            cid: "b_rel_stale_1",
            title: "合成・シリーズ関連 stale",
            maker: "合成著者",
            seriesId: "series_syn_1",
            imageUrl: null,
            productUrl: null,
          },
          relation: {
            evidence: [
              {
                kind: "series",
                origin: "store",
                anchorValue: "series_syn_1",
                productValue: "series_syn_1",
              },
            ],
          },
          ownership: {
            status: "not_confirmed",
            matchedBy: null,
            ownedBy: [],
          },
          price: {
            current: {
              amountMinor: 990,
              currency: "JPY",
              taxStatus: "excluded",
            },
            regular: null,
            discountPercent: null,
            saleEndsAt: null,
            observedAt: "2026-08-01T00:00:00.000Z",
            freshness: "stale",
          },
        },
        {
          product: {
            source: "dlsite",
            cid: "RJ900404",
            title: "合成・価格なし関連",
            maker: "合成サークル",
            seriesId: null,
            imageUrl: null,
            productUrl: null,
          },
          relation: {
            evidence: [
              {
                kind: "maker",
                origin: "derived",
                anchorValue: "合成サークル",
                productValue: "合成サークル",
              },
            ],
          },
          ownership: {
            status: "not_confirmed",
            matchedBy: null,
            ownedBy: [],
          },
          price: {
            current: null,
            regular: null,
            discountPercent: null,
            saleEndsAt: null,
            observedAt: "2026-08-09T10:00:00.000Z",
            freshness: "unavailable",
          },
        },
        {
          product: {
            source: "fanza_doujin",
            cid: "d_rel_sale_1",
            title: "合成・ストア関連セール作品",
            maker: "別サークル",
            seriesId: null,
            imageUrl: null,
            productUrl: "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_rel_sale_1/",
          },
          relation: {
            evidence: [
              {
                kind: "store_related",
                origin: "store",
                anchorValue: null,
                productValue: "この作品を見た人はこちらも",
              },
            ],
          },
          ownership: {
            status: "possible_duplicate",
            matchedBy: "title_maker",
            ownedBy: [{ source: "fanza_doujin", cid: "d_owned_dup" }],
          },
          price: {
            current: {
              amountMinor: 550,
              currency: "JPY",
              taxStatus: "unknown",
            },
            regular: {
              amountMinor: 1100,
              currency: "JPY",
              taxStatus: "unknown",
            },
            discountPercent: 50,
            saleEndsAt: null,
            observedAt: "2026-08-09T10:00:00.000Z",
            freshness: "fresh",
          },
        },
      ],
      total: 4,
      warnings: [{ source: "fanza_books", code: "stale" }],
    };

    defineGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/listings")) {
        return new Response(JSON.stringify(listingsPayload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/related-products")) {
        assert.match(url, /anchorSource=dlsite/);
        assert.match(url, /anchorCid=RJ000001/);
        return new Response(JSON.stringify(relatedPayload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const { renderRelated } = await import("../src/pages/related.js");
    const root = document.createElement("div");
    document.body.append(root);
    await renderRelated(root);

    const ownedCard = root.querySelector('[data-testid="related-owned-card"]');
    assert.ok(ownedCard);
    assert.equal(ownedCard?.getAttribute("data-cid"), "RJ000001");
    assert.match(ownedCard?.textContent ?? "", /所有 listing/);

    // Results empty until load
    assert.ok(root.querySelector('[data-testid="related-results"]'));

    const load = root.querySelector(
      '[data-testid="related-load"]',
    ) as HTMLButtonElement;
    load.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const table = root.querySelector('[data-testid="related-table"]');
    assert.ok(table);
    const rows = root.querySelectorAll('[data-testid="related-row"]');
    assert.equal(rows.length, 4);

    // Owned anchor is not a row in the related table
    for (const row of rows) {
      assert.notEqual(row.getAttribute("data-cid"), "RJ000001");
    }

    const fresh = root.querySelector('[data-cid="RJ900101"]');
    assert.equal(fresh?.getAttribute("data-freshness"), "fresh");
    assert.match(fresh?.textContent ?? "", /maker\(derived\)/);
    assert.match(fresh?.textContent ?? "", /20%/);
    assert.match(fresh?.textContent ?? "", /2026-08-20T15:00:00.000Z/);

    const stale = root.querySelector('[data-cid="b_rel_stale_1"]');
    assert.equal(stale?.getAttribute("data-freshness"), "stale");
    assert.match(stale?.textContent ?? "", /古い観測/);
    assert.match(stale?.textContent ?? "", /未取得（推測しない）/);

    const unavailable = root.querySelector('[data-cid="RJ900404"]');
    assert.equal(unavailable?.getAttribute("data-freshness"), "unavailable");
    assert.match(unavailable?.textContent ?? "", /価格なし/);

    const marked = root.querySelector('[data-cid="d_rel_sale_1"]');
    assert.equal(marked?.getAttribute("data-ownership"), "possible_duplicate");
    assert.match(marked?.textContent ?? "", /store_related/);
    assert.match(marked?.textContent ?? "", /重複の可能性/);

    // Safe link attributes
    const link = root.querySelector(
      'a[href="https://www.dlsite.com/maniax/work/=/product_id/RJ900101.html"]',
    );
    assert.equal(link?.getAttribute("rel"), "noreferrer noopener");
  });
});
