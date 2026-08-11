import type { Money } from "@adp/shared";

import { isVisible, visibleTextOf } from "../dom-visibility.js";
import {
  extractVisiblePriceTiers,
  parseVisibleYenMoney,
  type ObservedPriceTiers,
} from "../price-observation.js";

export type CartPriceSource = "dlsite" | "fanza_doujin";

/**
 * The cart comparison deliberately exposes one value per store.  The source
 * page may expose several tiers, but the value a user is about to pay is the
 * most specific visible tier in this order.
 */
export function selectFinalPrice(tiers: ObservedPriceTiers): Money | null {
  return tiers.coupon ?? tiers.sale ?? tiers.regular;
}

export type FinalPriceVerdict =
  | "origin_cheaper"
  | "target_cheaper"
  | "equal"
  | "unavailable";

export function compareFinalPrices(
  origin: Money | null,
  target: Money | null,
): FinalPriceVerdict {
  if (!origin || !target) return "unavailable";
  if (origin.currency !== target.currency || origin.taxStatus !== target.taxStatus) {
    return "unavailable";
  }
  if (origin.amountMinor < target.amountMinor) return "origin_cheaper";
  if (target.amountMinor < origin.amountMinor) return "target_cheaper";
  return "equal";
}

export function formatFinalPrice(money: Money | null): string {
  if (!money) return "未取得";
  const amount = money.amountMinor.toLocaleString("ja-JP");
  if (money.taxStatus === "included") return `${amount}円（税込）`;
  if (money.taxStatus === "excluded") return `${amount}円（税別）`;
  return `${amount}円`;
}

function parseCartPriceValue(raw: string | null): Money | null {
  const value = raw?.trim() ?? "";
  if (!value) return null;
  const text = /(?:円|JPY|¥|￥)/i.test(value) ? value : `${value}円`;
  return parseVisibleYenMoney(text);
}

function readDataPrice(host: Element): Money | null {
  // These attributes are visible-cart metadata observed on the supported
  // storefronts.  They are fallbacks only; visible labeled prices win.
  for (const name of [
    "data-price",
    "data-current-price",
    "data-basket-price",
  ]) {
    const parsed = parseCartPriceValue(host.getAttribute(name));
    if (parsed) return parsed;
  }
  return null;
}

function readPriceClass(host: Element): Money | null {
  const candidates = new Map<string, Money>();
  for (const element of Array.from(host.querySelectorAll("*"))) {
    const className = element.getAttribute("class") ?? "";
    if (!/(^|[-_])price(?:[-_]|$)/i.test(className)) continue;
    if (!isVisible(element)) continue;
    const parsed = parseCartPriceValue(visibleTextOf(element));
    if (!parsed) continue;
    candidates.set(
      `${parsed.amountMinor}|${parsed.currency}|${parsed.taxStatus}`,
      parsed,
    );
  }
  return candidates.size === 1 ? [...candidates.values()][0]! : null;
}

/**
 * Read a cart-row price without leaving the current page.  No network call,
 * coupon click, or cart mutation occurs here.
 */
export function readCartFinalPrice(
  source: CartPriceSource,
  host: Element,
  fallback: Money | null = null,
): Money | null {
  const tiers = extractVisiblePriceTiers(source, host);
  return selectFinalPrice(tiers) ?? readDataPrice(host) ?? readPriceClass(host) ?? fallback;
}

export function finalPriceTiers(money: Money | null): {
  regular: Money | null;
  sale: Money | null;
  coupon: Money | null;
} {
  return { regular: null, sale: null, coupon: money };
}
