import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compareFinalPrices,
  finalPriceTiers,
  readCartFinalPrice,
  selectFinalPrice,
} from "../final-price.js";
import {
  mountCartPriceComparison,
  type CartPriceComparisonDeps,
} from "../price-comparison.js";
import { MockDocument } from "../../test/mock-document.js";
import {
  MSG_DISCOVERY_RESULT,
  type DiscoveryResultMessage,
} from "../../../messages.js";
import type { Money } from "@adp/shared";

function money(amountMinor: number): Money {
  return { amountMinor, currency: "JPY", taxStatus: "unknown" };
}

describe("cart final-price comparison", () => {
  it("selects coupon, then sale, then regular as the one final price", () => {
    assert.equal(
      selectFinalPrice({ regular: money(110), sale: money(77), coupon: money(55) })?.amountMinor,
      55,
    );
    assert.equal(
      selectFinalPrice({ regular: money(110), sale: money(77), coupon: null })?.amountMinor,
      77,
    );
    assert.equal(
      selectFinalPrice({ regular: money(110), sale: null, coupon: null })?.amountMinor,
      110,
    );
  });

  it("compares only matching currency and tax semantics", () => {
    assert.equal(compareFinalPrices(money(55), money(77)), "origin_cheaper");
    assert.equal(compareFinalPrices(money(77), money(55)), "target_cheaper");
    assert.equal(compareFinalPrices(money(55), money(55)), "equal");
    assert.equal(
      compareFinalPrices(money(55), { ...money(77), taxStatus: "included" }),
      "unavailable",
    );
  });

  it("uses visible-cart data-price as a fallback when no labeled tier exists", () => {
    const doc = new MockDocument();
    const host = doc.createElement("li");
    host.setAttribute("data-price", "110");
    doc.body.appendChild(host);

    assert.deepEqual(readCartFinalPrice("dlsite", host), money(110));
  });

  it("renders final prices side by side and links the confirmed counterpart product", async () => {
    const doc = new MockDocument();
    const host = doc.createElement("li");
    doc.body.appendChild(host);
    const row = {
      cid: "RJ123456",
      title: "サンプル同人作品",
      maker: "サークル名",
      host,
    };
    let listener: ((message: unknown) => boolean) | null = null;
    let started: { originTiers?: ReturnType<typeof finalPriceTiers> } | null = null;
    const deps: CartPriceComparisonDeps = {
      createSessionId: () => "cart-session-1",
      addMessageListener: (next) => {
        listener = next;
      },
      removeMessageListener: () => {
        listener = null;
      },
      sendStart: async (message) => {
        started = message;
        return { ok: true, sessionId: message.sessionId };
      },
    };

    mountCartPriceComparison(
      doc as unknown as Document,
      "dlsite",
      row,
      money(110),
      deps,
    );

    const button = host.querySelector(".adp-cart-price-comparison__button") as {
      onclick?: (event?: { preventDefault?: () => void; stopPropagation?: () => void }) => void;
    };
    assert.ok(button?.onclick);
    button.onclick({});
    await Promise.resolve();
    assert.equal(started?.originTiers?.coupon?.amountMinor, 110);

    const result: DiscoveryResultMessage = {
      type: MSG_DISCOVERY_RESULT,
      sessionId: "cart-session-1",
      ok: true,
      kind: "compare",
      targetSource: "fanza_doujin",
      targetCid: "d_900001",
      targetTitle: "サンプル同人作品",
      targetMaker: "サークル名",
      targetProductUrl: "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_900001/",
      originTiers: finalPriceTiers(money(110)),
      targetTiers: finalPriceTiers(money(55)),
    };
    listener?.(result);

    assert.match(host.textContent, /最終価格: DLsite 110円 \/ FANZA同人 55円/);
    assert.match(host.textContent, /FANZA同人が安い/);
    const link = host.querySelector(".adp-cart-price-comparison__link") as { href?: string };
    assert.equal(link?.href, result.targetProductUrl);
  });

  it("promotes a user-selected owned counterpart to a duplicate callback", async () => {
    const doc = new MockDocument();
    const host = doc.createElement("li");
    doc.body.appendChild(host);
    const row = {
      cid: "RJ01185774",
      title: "DLsite表記の作品名",
      maker: "巨乳大好き屋",
      host,
    };
    let listener: ((message: unknown) => boolean) | null = null;
    let confirmed: unknown = null;
    const deps = {
      createSessionId: () => "cart-session-owned-counterpart",
      addMessageListener: (next: (message: unknown) => boolean) => {
        listener = next;
      },
      removeMessageListener: () => {
        listener = null;
      },
      sendStart: async () => ({
        ok: true as const,
        sessionId: "cart-session-owned-counterpart",
      }),
      lookupCounterpart: async (item: {
        source: string;
        cid: string;
        title: string;
        maker?: string;
      }) => {
        assert.deepEqual(item, {
          source: "fanza_doujin",
          cid: "d_375259",
          title: "FANZA表記の作品名",
          maker: "巨乳大好き屋",
        });
        return [{ owned: true, other: [] }];
      },
      onConfirmedDuplicate: (cid: string, hit: unknown) => {
        confirmed = { cid, hit };
      },
    } as unknown as CartPriceComparisonDeps;

    mountCartPriceComparison(
      doc as unknown as Document,
      "dlsite",
      row,
      money(110),
      deps,
    );

    const button = host.querySelector(".adp-cart-price-comparison__button") as {
      onclick?: (event?: { preventDefault?: () => void; stopPropagation?: () => void }) => void;
    };
    assert.ok(button?.onclick);
    button.onclick({});
    await Promise.resolve();

    listener?.({
      type: MSG_DISCOVERY_RESULT,
      sessionId: "cart-session-owned-counterpart",
      ok: true,
      kind: "compare",
      targetSource: "fanza_doujin",
      targetCid: "d_375259",
      targetTitle: "FANZA表記の作品名",
      targetMaker: "巨乳大好き屋",
      targetProductUrl: "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_375259/",
      originTiers: finalPriceTiers(money(110)),
      targetTiers: finalPriceTiers(money(55)),
    } satisfies DiscoveryResultMessage);

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(confirmed, {
      cid: "RJ01185774",
      hit: {
        owned: false,
        other: [
          {
            source: "fanza_doujin",
            cid: "d_375259",
            title: "FANZA表記の作品名",
            url: "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_375259/",
          },
        ],
      },
    });
  });
});
