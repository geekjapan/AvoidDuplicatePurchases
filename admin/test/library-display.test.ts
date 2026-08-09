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

    // Price filter/sort controls expose observation-only contract.
    assert.ok(window.document.querySelector('[data-testid="filter-price-currency"]'));
    assert.ok(window.document.querySelector('[data-testid="filter-price-tier"]'));
    assert.ok(window.document.querySelector('[data-testid="filter-sort"]'));
    const sortSelect = window.document.querySelector(
      '[data-testid="filter-sort"]',
    ) as HTMLSelectElement;
    const sortValues = Array.from(sortSelect.options).map((o) => o.value);
    assert.ok(sortValues.includes("price_observation_asc"));
    assert.ok(sortValues.includes("price_observation_desc"));
    assert.equal(sortValues.includes("current_price_asc"), false);

    const missing = window.document.querySelector('[data-cid="v_display_2"]')!;
    assert.equal(missing.querySelector("img"), null);
    assert.equal(missing.querySelector("a"), null);
    assert.match(missing.textContent ?? "", /未取得/);
    assert.match(missing.textContent ?? "", /購入日: 未取得/);

    image.dispatchEvent(new window.Event("error"));
    assert.equal(row.querySelector("img"), null);
    assert.match(row.textContent ?? "", /未取得/);
  });

  /**
   * Issue #42: admin groups the flat GET /api/listings contract by workId and
   * renders title / maker / source / purchase date / image / verified link /
   * 未取得 without inventing work-level aggregates.
   */
  it("renders the five current sources with work grouping and 未取得 boundaries", async () => {
    window = installDom();
    const payload: ListingPayload = {
      listings: [
        {
          id: 1,
          source: "dlsite",
          cid: "RJ_DISP_001",
          workId: 100,
          workIdLocked: false,
          title: "DLsite表示",
          maker: "サークル表示",
          seriesId: null,
          imageUrl: "https://img.example/dlsite.jpg",
          imageProvenance: "store_product_metadata",
          productUrl: "https://www.dlsite.com/maniax/work/=/product_id/RJ_DISP_001.html",
          productUrlProvenance: "verified_derived",
          purchasedAt: "2022-06-11T14:20:07.000Z",
          purchasedAtPrecision: "second",
          purchasePrice: null,
          currentPrice: null,
          priceObservation: null,
        },
        {
          id: 2,
          source: "fanza_doujin",
          cid: "d_disp_1",
          workId: 100,
          workIdLocked: false,
          title: "同人表示",
          maker: "メーカー表示",
          seriesId: null,
          imageUrl: "https://img.example/doujin.jpg",
          imageProvenance: "store_library_metadata",
          productUrl: "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_disp_1/",
          productUrlProvenance: "verified_derived",
          purchasedAt: "2026-07-24",
          purchasedAtPrecision: "day",
          purchasePrice: null,
          currentPrice: null,
          priceObservation: null,
        },
        {
          id: 3,
          source: "fanza_books",
          cid: "b_disp_1",
          workId: 200,
          workIdLocked: false,
          title: "Books表示",
          maker: "著者表示",
          seriesId: "series-1",
          imageUrl: null,
          imageProvenance: null,
          productUrl: "https://book.dmm.co.jp/product/series-1/b_disp_1/",
          productUrlProvenance: "verified_derived",
          purchasedAt: "2023-12-30T12:00:00+09:00",
          purchasedAtPrecision: "second",
          purchasePrice: null,
          currentPrice: null,
          priceObservation: null,
        },
        {
          id: 4,
          source: "fanza_video",
          cid: "v_disp_1",
          workId: 300,
          workIdLocked: false,
          title: "Video表示",
          maker: null,
          seriesId: null,
          imageUrl: null,
          imageProvenance: null,
          productUrl: "https://video.dmm.co.jp/av/content/?id=v_disp_1",
          productUrlProvenance: "verified_derived",
          purchasedAt: null,
          purchasedAtPrecision: "unknown",
          purchasePrice: null,
          currentPrice: null,
          priceObservation: null,
        },
        {
          id: 5,
          source: "fanza_dlsoft",
          cid: "dl_disp_1",
          workId: 400,
          workIdLocked: false,
          title: "dlsoft表示",
          maker: "ブランド表示",
          seriesId: null,
          imageUrl: "https://img.example/dlsoft.jpg",
          imageProvenance: "store_library_metadata",
          productUrl: "https://dlsoft.dmm.co.jp/detail/dl_disp_1/",
          productUrlProvenance: "verified_derived",
          purchasedAt: null,
          purchasedAtPrecision: "unknown",
          purchasePrice: null,
          currentPrice: null,
          priceObservation: null,
        },
      ],
      total: 5,
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

    const groups = window.document.querySelectorAll(".work-group");
    assert.equal(groups.length, 4);
    const multi = window.document.querySelector('[data-work-id="100"]');
    assert.equal(multi?.querySelector("header")?.textContent, "作品グループ（2 件）");
    // Group header is count-only — no work-level title/image aggregate.
    assert.equal(multi?.querySelector("header")?.textContent?.includes("DLsite表示"), false);

    const dlsite = window.document.querySelector('[data-cid="RJ_DISP_001"]')!;
    assert.match(dlsite.textContent ?? "", /DLsite表示/);
    assert.match(dlsite.textContent ?? "", /dlsite \/ RJ_DISP_001/);
    assert.match(dlsite.textContent ?? "", /サークル表示/);
    assert.match(dlsite.textContent ?? "", /購入日:/);
    assert.equal(
      (dlsite.querySelector("img") as HTMLImageElement | null)?.getAttribute("src"),
      "https://img.example/dlsite.jpg",
    );
    assert.equal(
      (dlsite.querySelector("a") as HTMLAnchorElement | null)?.getAttribute("href"),
      "https://www.dlsite.com/maniax/work/=/product_id/RJ_DISP_001.html",
    );
    assert.match(dlsite.textContent ?? "", /購入価格: 未取得/);
    assert.match(dlsite.textContent ?? "", /現在価格: 未取得/);

    const books = window.document.querySelector('[data-cid="b_disp_1"]')!;
    assert.equal(books.querySelector("img"), null);
    assert.match(books.textContent ?? "", /Books表示/);
    assert.match(books.textContent ?? "", /著者表示/);
    assert.match(books.textContent ?? "", /fanza_books \/ b_disp_1/);
    assert.ok(books.querySelector(".image-placeholder"));
    assert.equal(
      (books.querySelector("a") as HTMLAnchorElement | null)?.getAttribute("href"),
      "https://book.dmm.co.jp/product/series-1/b_disp_1/",
    );

    const video = window.document.querySelector('[data-cid="v_disp_1"]')!;
    assert.match(video.textContent ?? "", /Video表示/);
    assert.match(video.textContent ?? "", /fanza_video \/ v_disp_1/);
    // maker null + unknown purchase date → 未取得 (not imported_at, not 0).
    assert.match(video.textContent ?? "", /未取得/);
    assert.match(video.textContent ?? "", /購入日: 未取得/);
    assert.equal(
      (video.querySelector("a") as HTMLAnchorElement | null)?.getAttribute("href"),
      "https://video.dmm.co.jp/av/content/?id=v_disp_1",
    );

    const dlsoft = window.document.querySelector('[data-cid="dl_disp_1"]')!;
    assert.match(dlsoft.textContent ?? "", /dlsoft表示/);
    assert.match(dlsoft.textContent ?? "", /ブランド表示/);
    assert.match(dlsoft.textContent ?? "", /購入日: 未取得/);
    assert.equal(
      (dlsoft.querySelector("img") as HTMLImageElement | null)?.getAttribute("src"),
      "https://img.example/dlsoft.jpg",
    );
  });
});
