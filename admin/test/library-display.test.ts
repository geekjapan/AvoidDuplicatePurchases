import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Window } from "happy-dom";

type ListingPayload = {
  listings: Array<Record<string, unknown>>;
  total: number;
};

function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

function installDom(): Window {
  const window = new Window({ url: "http://127.0.0.1:41321/" });
  defineGlobal("window", window);
  defineGlobal("self", window);
  defineGlobal("document", window.document);
  defineGlobal("HTMLElement", window.HTMLElement);
  defineGlobal("HTMLInputElement", window.HTMLInputElement);
  defineGlobal("HTMLButtonElement", window.HTMLButtonElement);
  defineGlobal("HTMLSelectElement", window.HTMLSelectElement);
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

describe("library display metadata", () => {
  let window: Window | undefined;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    defineGlobal("fetch", originalFetch);
    window?.close();
    window = undefined;
  });

  it("renders images, dates, safe product links, and 未取得 placeholders", async () => {
    window = installDom();
    const payload: ListingPayload = {
      listings: [
        {
          id: 1,
          source: "fanza_doujin",
          cid: "d_display_1",
          workId: 10,
          workIdLocked: false,
          title: "表示作品",
          maker: "表示メーカー",
          seriesId: null,
          imageUrl: "https://img.example/display.jpg",
          imageProvenance: "store_library_metadata",
          productUrl: "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_display_1/",
          productUrlProvenance: "verified_derived",
          purchasedAt: "2026-07-24",
          purchasedAtPrecision: "day",
          purchasePrice: {
            amountMinor: 1234,
            currency: "JPY",
            taxStatus: "included",
          },
          currentPrice: {
            amountMinor: 1480,
            currency: "JPY",
            taxStatus: "unknown",
            observedAt: "2026-08-08T00:00:00.000Z",
            provenance: "store_product_metadata",
          },
          priceObservation: {
            regular: { amountMinor: 1100, currency: "JPY", taxStatus: "unknown" },
            sale: { amountMinor: 880, currency: "JPY", taxStatus: "included" },
            coupon: null,
            observedAt: "2026-08-08T12:00:00.000Z",
          },
        },
        {
          id: 2,
          source: "fanza_video",
          cid: "v_display_2",
          workId: 11,
          workIdLocked: false,
          title: "欠損作品",
          maker: null,
          seriesId: null,
          imageUrl: null,
          imageProvenance: null,
          productUrl: null,
          productUrlProvenance: null,
          purchasedAt: "2026-08-08",
          purchasedAtPrecision: "unknown",
          purchasePrice: null,
          currentPrice: null,
          priceObservation: null,
        },
      ],
      total: 2,
    };
    defineGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    const { renderLibrary } = await import("../src/pages/library.js");
    await renderLibrary(window.document.getElementById("app")!);

    const row = window.document.querySelector('[data-cid="d_display_1"]')!;
    const groupHeader = row.closest(".work-group")?.querySelector("header");
    assert.equal(groupHeader?.textContent, "作品グループ（1 件）");
    const image = row.querySelector("img") as HTMLImageElement;
    assert.ok(image);
    assert.equal(image.getAttribute("alt"), "表示作品");
    assert.equal(image.getAttribute("loading"), "lazy");
    assert.equal(image.getAttribute("referrerpolicy"), "no-referrer");
    assert.equal(image.getAttribute("src"), "https://img.example/display.jpg");
    assert.match(row.textContent ?? "", /2026-07-24/);
    assert.match(row.textContent ?? "", /購入価格: JPY 1234/);
    assert.match(row.textContent ?? "", /現在価格: JPY 1480/);
    assert.match(row.textContent ?? "", /取得時刻: 2026-08-08T00:00:00.000Z/);
    assert.match(row.textContent ?? "", /定価\/サークル設定価格: JPY 1100/);
    assert.match(row.textContent ?? "", /セール\/キャンペーン価格: JPY 880/);
    assert.match(row.textContent ?? "", /クーポン適用後表示価格: 未取得/);
    assert.match(row.textContent ?? "", /観測時刻: 2026-08-08T12:00:00.000Z/);

    const link = row.querySelector("a") as HTMLAnchorElement;
    assert.ok(link);
    assert.equal(link.getAttribute("target"), "_blank");
    assert.equal(link.getAttribute("rel"), "noreferrer noopener");
    assert.equal(
      link.getAttribute("href"),
      "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_display_1/",
    );

    const missing = window.document.querySelector('[data-cid="v_display_2"]')!;
    assert.equal(missing.querySelector("img"), null);
    assert.equal(missing.querySelector("a"), null);
    assert.match(missing.textContent ?? "", /未取得/);
    assert.match(missing.textContent ?? "", /購入日: 未取得/);

    image.dispatchEvent(new window.Event("error"));
    assert.equal(row.querySelector("img"), null);
    assert.match(row.textContent ?? "", /未取得/);
  });
});
