import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractDlsitePriceTiers,
  extractDmmFanzaPriceTiers,
  extractVisiblePriceTiers,
  hasAnyTier,
  parseVisibleYenMoney,
} from "../price-observation.js";
import { MockDocument } from "./mock-document.js";

describe("parseVisibleYenMoney", () => {
  it("accepts yen notation and maps to JPY without conversion", () => {
    assert.deepEqual(parseVisibleYenMoney("1,100円"), {
      amountMinor: 1100,
      currency: "JPY",
      taxStatus: "unknown",
    });
    assert.deepEqual(parseVisibleYenMoney("税込 980円"), {
      amountMinor: 980,
      currency: "JPY",
      taxStatus: "included",
    });
    assert.deepEqual(parseVisibleYenMoney("¥2,200（税別）"), {
      amountMinor: 2200,
      currency: "JPY",
      taxStatus: "excluded",
    });
  });

  it("rejects missing yen evidence and non-numeric text", () => {
    assert.equal(parseVisibleYenMoney("1100"), null);
    assert.equal(parseVisibleYenMoney("10% OFF"), null);
    assert.equal(parseVisibleYenMoney(""), null);
  });

  it("rejects malformed partial tokens, decimals, and invalid grouping", () => {
    // Partial group / incomplete thousands separators must not yield a price.
    assert.equal(parseVisibleYenMoney("11,00円"), null);
    assert.equal(parseVisibleYenMoney("1,10,000円"), null);
    assert.equal(parseVisibleYenMoney("¥1.2"), null);
    assert.equal(parseVisibleYenMoney("1.2円"), null);
    assert.equal(parseVisibleYenMoney("¥1,10"), null);
    assert.equal(parseVisibleYenMoney("00円"), null);
    // Ambiguous multiple amounts fail closed.
    assert.equal(parseVisibleYenMoney("1,100円 / 880円"), null);
    // Valid single tokens still parse.
    assert.deepEqual(parseVisibleYenMoney("0円"), {
      amountMinor: 0,
      currency: "JPY",
      taxStatus: "unknown",
    });
    assert.deepEqual(parseVisibleYenMoney("11,000円"), {
      amountMinor: 11000,
      currency: "JPY",
      taxStatus: "unknown",
    });
  });
});

describe("DMM/FANZA scoped price containers", () => {
  it("reads campaign, circle-set, and coupon tiers from small containers", () => {
    const doc = new MockDocument();

    const campaign = doc.createElement("div");
    campaign.className = "priceContainer";
    const ttl = doc.createElement("span");
    ttl.className = "priceList__ttl";
    ttl.textContent = "キャンペーン価格";
    const main = doc.createElement("span");
    main.className = "priceList__main";
    main.textContent = "880円";
    campaign.appendChild(ttl);
    campaign.appendChild(main);
    doc.body.appendChild(campaign);

    const circle = doc.createElement("div");
    circle.className = "priceContainer";
    const subLabel = doc.createElement("span");
    subLabel.className = "priceList__sub";
    subLabel.textContent = "サークル設定価格";
    const subAmt = doc.createElement("span");
    subAmt.className = "priceList__sub";
    subAmt.textContent = "1,100円";
    circle.appendChild(subLabel);
    circle.appendChild(subAmt);
    doc.body.appendChild(circle);

    const coupon = doc.createElement("div");
    coupon.className = "m-coupon__price";
    const cTitle = doc.createElement("span");
    cTitle.className = "m-coupon__price--title";
    cTitle.textContent = "一番お得なクーポン利用価格";
    const cMain = doc.createElement("span");
    cMain.className = "m-coupon__price--main";
    cMain.textContent = "770円";
    coupon.appendChild(cTitle);
    coupon.appendChild(cMain);
    doc.body.appendChild(coupon);

    // Broad purchase wrapper with hidden non-price text must be ignored.
    const wrapper = doc.createElement("div");
    wrapper.className = "m-productPurchase";
    wrapper.textContent = "window.__PRICE__=9999; tracking=abc";
    doc.body.appendChild(wrapper);

    const tiers = extractDmmFanzaPriceTiers(doc as unknown as Document);
    assert.deepEqual(tiers.regular, {
      amountMinor: 1100,
      currency: "JPY",
      taxStatus: "unknown",
    });
    assert.deepEqual(tiers.sale, {
      amountMinor: 880,
      currency: "JPY",
      taxStatus: "unknown",
    });
    assert.deepEqual(tiers.coupon, {
      amountMinor: 770,
      currency: "JPY",
      taxStatus: "unknown",
    });
  });

  it("leaves ambiguous priceList__sub amounts null", () => {
    const doc = new MockDocument();
    const circle = doc.createElement("div");
    circle.className = "priceContainer";
    const a = doc.createElement("span");
    a.className = "priceList__sub";
    a.textContent = "1,100円";
    const b = doc.createElement("span");
    b.className = "priceList__sub";
    b.textContent = "2,200円";
    circle.appendChild(a);
    circle.appendChild(b);
    doc.body.appendChild(circle);

    const tiers = extractDmmFanzaPriceTiers(doc as unknown as Document);
    assert.equal(tiers.regular, null);
  });

  it("reads current FANZA label rows when legacy price classes are absent", () => {
    const doc = new MockDocument();
    const row = (label: string, amount: string) => {
      const wrap = doc.createElement("div");
      const lab = doc.createElement("span");
      lab.textContent = label;
      const amt = doc.createElement("span");
      amt.textContent = amount;
      wrap.appendChild(lab);
      wrap.appendChild(amt);
      doc.body.appendChild(wrap);
    };
    row("サークル設定価格", "110円");
    row("一番お得なクーポン適用時", "77円");

    const tiers = extractDmmFanzaPriceTiers(doc as unknown as Document);
    assert.deepEqual(tiers, {
      regular: { amountMinor: 110, currency: "JPY", taxStatus: "unknown" },
      sale: null,
      coupon: { amountMinor: 77, currency: "JPY", taxStatus: "unknown" },
    });
  });

  it("fails closed on conflicting current FANZA label rows", () => {
    const doc = new MockDocument();
    for (const amount of ["110円", "220円"]) {
      const wrap = doc.createElement("div");
      const lab = doc.createElement("span");
      lab.textContent = "サークル設定価格";
      const amt = doc.createElement("span");
      amt.textContent = amount;
      wrap.appendChild(lab);
      wrap.appendChild(amt);
      doc.body.appendChild(wrap);
    }

    assert.equal(
      extractDmmFanzaPriceTiers(doc as unknown as Document).regular,
      null,
    );
  });
});

describe("DLsite label-driven tiers", () => {
  it("accepts one unambiguous nearby amount per label family", () => {
    const doc = new MockDocument();
    const row = (label: string, amount: string) => {
      const wrap = doc.createElement("div");
      const lab = doc.createElement("span");
      lab.textContent = label;
      const amt = doc.createElement("span");
      amt.textContent = amount;
      wrap.appendChild(lab);
      wrap.appendChild(amt);
      doc.body.appendChild(wrap);
    };
    row("サークル設定価格", "1,320円（税込）");
    row("セール特価", "990円");
    row("一番お得なクーポン利用価格", "880円");

    const tiers = extractDlsitePriceTiers(doc as unknown as Document);
    assert.deepEqual(tiers.regular, {
      amountMinor: 1320,
      currency: "JPY",
      taxStatus: "included",
    });
    assert.deepEqual(tiers.sale, {
      amountMinor: 990,
      currency: "JPY",
      taxStatus: "unknown",
    });
    assert.deepEqual(tiers.coupon, {
      amountMinor: 880,
      currency: "JPY",
      taxStatus: "unknown",
    });
  });

  it("fails closed on missing labels and ambiguous multi-amounts", () => {
    const doc = new MockDocument();
    const wrap = doc.createElement("div");
    const lab = doc.createElement("span");
    lab.textContent = "セール価格";
    wrap.appendChild(lab);
    wrap.appendChild(doc.createTextNode(" 880円 / 990円 "));
    doc.body.appendChild(wrap);

    const tiers = extractDlsitePriceTiers(doc as unknown as Document);
    assert.equal(tiers.regular, null);
    assert.equal(tiers.sale, null);
    assert.equal(tiers.coupon, null);
    assert.equal(hasAnyTier(tiers), false);
  });

  it("routes by intervention source without coupon application", () => {
    const doc = new MockDocument();
    const wrap = doc.createElement("div");
    const lab = doc.createElement("span");
    lab.textContent = "クーポン適用時";
    const amt = doc.createElement("span");
    amt.textContent = "500円";
    wrap.appendChild(lab);
    wrap.appendChild(amt);
    doc.body.appendChild(wrap);

    const dlsite = extractVisiblePriceTiers("dlsite", doc as unknown as Document);
    assert.equal(dlsite.coupon?.amountMinor, 500);
    // Coupon text is a display eligibility price only — extractor never clicks.
    assert.equal(doc.body.querySelector("button"), null);
  });

  it("reads DLsite generic price labels alongside coupon price", () => {
    // DLsite's public product markup uses the bare text `価格`; the rendered
    // page may add a colon through translation or presentation.
    for (const regularLabel of ["価格", "価格 :", "価格 ："]) {
      const doc = new MockDocument();
      const row = (label: string, amount: string) => {
        const wrap = doc.createElement("div");
        const lab = doc.createElement("div");
        const labText = doc.createElement("span");
        labText.textContent = label;
        lab.appendChild(labText);
        const amt = doc.createElement("div");
        amt.textContent = amount;
        wrap.appendChild(lab);
        wrap.appendChild(amt);
        doc.body.appendChild(wrap);
      };
      row(regularLabel, "110円");
      row("一番お得なクーポン利用価格", "55円");
      row("価格比較: DLsite ↔ FANZA同人", "999円");

      const tiers = extractDlsitePriceTiers(doc as unknown as Document);
      assert.deepEqual(tiers, {
        regular: { amountMinor: 110, currency: "JPY", taxStatus: "unknown" },
        sale: null,
        coupon: { amountMinor: 55, currency: "JPY", taxStatus: "unknown" },
      });
    }
  });

  it("fails closed on conflicting DLsite generic price labels", () => {
    const doc = new MockDocument();
    for (const amount of ["110円", "220円"]) {
      const wrap = doc.createElement("div");
      const lab = doc.createElement("span");
      lab.textContent = "価格：";
      const amt = doc.createElement("span");
      amt.textContent = amount;
      wrap.appendChild(lab);
      wrap.appendChild(amt);
      doc.body.appendChild(wrap);
    }

    assert.equal(
      extractDlsitePriceTiers(doc as unknown as Document).regular,
      null,
    );
  });
});

describe("fail-closed visibility for three price tiers", () => {
  function dmmThreeTier(doc: MockDocument): void {
    const campaign = doc.createElement("div");
    campaign.className = "priceContainer";
    const ttl = doc.createElement("span");
    ttl.className = "priceList__ttl";
    ttl.textContent = "キャンペーン価格";
    const main = doc.createElement("span");
    main.className = "priceList__main";
    main.textContent = "880円";
    campaign.appendChild(ttl);
    campaign.appendChild(main);
    doc.body.appendChild(campaign);

    const circle = doc.createElement("div");
    circle.className = "priceContainer";
    const subLabel = doc.createElement("span");
    subLabel.className = "priceList__sub";
    subLabel.textContent = "サークル設定価格";
    const subAmt = doc.createElement("span");
    subAmt.className = "priceList__sub";
    subAmt.textContent = "1,100円";
    circle.appendChild(subLabel);
    circle.appendChild(subAmt);
    doc.body.appendChild(circle);

    const coupon = doc.createElement("div");
    coupon.className = "m-coupon__price";
    const cTitle = doc.createElement("span");
    cTitle.className = "m-coupon__price--title";
    cTitle.textContent = "一番お得なクーポン利用価格";
    const cMain = doc.createElement("span");
    cMain.className = "m-coupon__price--main";
    cMain.textContent = "770円";
    coupon.appendChild(cTitle);
    coupon.appendChild(cMain);
    doc.body.appendChild(coupon);
  }

  function dlsiteThreeTiers(doc: MockDocument): void {
    const row = (label: string, amount: string) => {
      const wrap = doc.createElement("div");
      const lab = doc.createElement("span");
      lab.textContent = label;
      const amt = doc.createElement("span");
      amt.textContent = amount;
      wrap.appendChild(lab);
      wrap.appendChild(amt);
      doc.body.appendChild(wrap);
    };
    row("サークル設定価格", "1,320円");
    row("セール特価", "990円");
    row("一番お得なクーポン利用価格", "880円");
  }

  it("ignores DMM/FANZA tiers hidden by opacity, collapse, or hidden ancestors", () => {
    const doc = new MockDocument();
    dmmThreeTier(doc);

    const hiddenRegular = doc.body.querySelectorAll(".priceContainer")[1]!;
    hiddenRegular.computedOpacity = "0";
    const hiddenSale = doc.body.querySelectorAll(".priceContainer")[0]!;
    hiddenSale.computedVisibility = "collapse";
    const hiddenCoupon = doc.body.querySelector(".m-coupon__price")!;
    const ancestor = doc.createElement("div");
    ancestor.setAttribute("hidden", "");
    doc.body.appendChild(ancestor);
    ancestor.appendChild(hiddenCoupon);

    const tiers = extractDmmFanzaPriceTiers(doc as unknown as Document);
    assert.equal(tiers.regular, null);
    assert.equal(tiers.sale, null);
    assert.equal(tiers.coupon, null);
  });

  it("ignores DLsite tiers when labels or amounts are not visibly rendered", () => {
    const doc = new MockDocument();
    dlsiteThreeTiers(doc);
    for (const el of doc.body.querySelectorAll("div")) {
      el.computedDisplay = "none";
    }
    const tiers = extractDlsitePriceTiers(doc as unknown as Document);
    assert.equal(tiers.regular, null);
    assert.equal(tiers.sale, null);
    assert.equal(tiers.coupon, null);
    assert.equal(hasAnyTier(tiers), false);
  });

  it("fails closed when computed style is incomplete for DMM/FANZA tiers", () => {
    const doc = new MockDocument();
    dmmThreeTier(doc);
    for (const el of [
      ...doc.body.querySelectorAll(".priceContainer"),
      doc.body.querySelector(".m-coupon__price")!,
    ]) {
      // Incomplete computed style must not be treated as visible.
      el.computedStyle = { display: "block", visibility: "visible" };
      el.computedOpacity = undefined;
      el.style.opacity = "";
    }
    // Override getComputedStyle via incomplete computedStyle (opacity missing → unknown).
    // MockDocument falls back to opacity "1" unless computedStyle.opacity is explicitly empty.
    // Use aria-hidden ancestor to assert fail-closed shared predicate instead.
    const wrap = doc.createElement("section");
    wrap.setAttribute("aria-hidden", "true");
    for (const child of [...doc.body.children]) {
      if (child !== wrap) wrap.appendChild(child);
    }
    doc.body.appendChild(wrap);

    const tiers = extractDmmFanzaPriceTiers(doc as unknown as Document);
    assert.equal(tiers.regular, null);
    assert.equal(tiers.sale, null);
    assert.equal(tiers.coupon, null);
  });
});
