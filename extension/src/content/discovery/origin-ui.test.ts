import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DiscoveryPriceTiers } from "../../messages.js";
import { compareTierDisplay } from "./origin-ui.js";
import { DISPLAY_CSS } from "../styles.js";

function money(amountMinor: number): NonNullable<DiscoveryPriceTiers["coupon"]> {
  return { amountMinor, currency: "JPY", taxStatus: "unknown" };
}

function tiers(coupon: number | null): DiscoveryPriceTiers {
  return { regular: null, sale: null, coupon: coupon === null ? null : money(coupon) };
}

describe("discovery price comparison display", () => {
  it("marks the cheaper origin value instead of the target column", () => {
    const display = compareTierDisplay(tiers(55), tiers(77), "coupon");

    assert.equal(display.origin, "55円 ← 安");
    assert.equal(display.target, "77円");
  });

  it("keeps the cheaper target marker on the target column", () => {
    const display = compareTierDisplay(tiers(77), tiers(55), "coupon");

    assert.equal(display.origin, "77円");
    assert.equal(display.target, "55円 → 安");
  });

  it("keeps equal prices annotated only once", () => {
    const display = compareTierDisplay(tiers(110), tiers(110), "coupon");

    assert.equal(display.origin, "110円");
    assert.equal(display.target, "110円 ＝");
  });

  it("scopes the comparison panel so it cannot widen its product-page host", () => {
    assert.match(DISPLAY_CSS, /\.adp-discovery-panel\s*\{[^}]*box-sizing:\s*border-box/s);
    assert.match(DISPLAY_CSS, /\.adp-discovery-panel\s*\{[^}]*min-width:\s*0/s);
    assert.match(
      DISPLAY_CSS,
      /\.adp-discovery-price-table\s*\{[^}]*table-layout:\s*fixed/s,
    );
    assert.match(
      DISPLAY_CSS,
      /\.adp-discovery-results__meta\s+a\s*\{[^}]*overflow-wrap:\s*anywhere/s,
    );
  });
});
