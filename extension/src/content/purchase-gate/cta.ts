import type { GateSurface, PurchaseCtaRole } from "./types.js";
import { ADP_CTA_ATTR } from "./types.js";

const INTERACTIVE = "a, button, input[type='submit'], input[type='button']";

const ROLE_BY_SURFACE: Record<GateSurface, PurchaseCtaRole> = {
  immediate_buy: "immediate-buy",
  cart: "cart-progress",
  purchase_progress: "purchase-progress",
};

/** Labels that indicate purchase progression (not cart-add). */
const PROGRESS_LABELS = [
  "即購入",
  "すぐに購入",
  "今すぐ購入",
  "購入手続き",
  "購入手続きへ",
  "レジに進む",
  "レジへ進む",
  "注文を確定",
  "注文を確定する",
  "支払いへ",
  "支払う",
  "決済へ",
  "購入を確定",
  "購入する",
  "Buy now",
  "Buy Now",
  "Checkout",
  "Place order",
];

/** Labels that must never be gated on product pages. */
const CART_ADD_LABELS = [
  "カートに入れる",
  "カートに追加",
  "カゴに入れる",
  "カゴへ入れる",
  "買い物カゴに入れる",
  "Add to cart",
  "Add to basket",
];

function normalizeLabel(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function labelMatches(text: string, labels: string[]): boolean {
  const n = normalizeLabel(text);
  if (!n) return false;
  return labels.some((label) => n === label || n.includes(label));
}

function roleOf(el: Element): PurchaseCtaRole | null {
  const raw = el.getAttribute(ADP_CTA_ATTR);
  if (
    raw === "immediate-buy" ||
    raw === "cart-add" ||
    raw === "cart-progress" ||
    raw === "purchase-progress"
  ) {
    return raw;
  }
  return null;
}

function isInteractive(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "a" || tag === "button") return true;
  if (tag === "input") {
    const type = (el.getAttribute("type") ?? "text").toLowerCase();
    return type === "submit" || type === "button" || type === "image";
  }
  return false;
}

/**
 * Find purchase CTAs for a gate surface.
 * Prefer explicit data-adp-purchase-cta markers (fixture + durable contract),
 * then best-effort label heuristics. Never returns cart-add roles for product gates.
 */
export function findPurchaseCtas(doc: Document, surface: GateSurface): HTMLElement[] {
  const wantedRole = ROLE_BY_SURFACE[surface];
  const found = new Set<HTMLElement>();

  // 1) Explicit markers (primary durable contract for synthetic + future live hooks).
  for (const el of Array.from(doc.querySelectorAll(`[${ADP_CTA_ATTR}]`))) {
    if (!isInteractive(el)) continue;
    const role = roleOf(el);
    if (role === wantedRole) found.add(el as HTMLElement);
  }

  // 2) Label heuristics for live stores without markers.
  for (const el of Array.from(doc.querySelectorAll(INTERACTIVE))) {
    if (!isInteractive(el)) continue;
    const htmlEl = el as HTMLElement;
    if (found.has(htmlEl)) continue;

    const role = roleOf(el);
    if (role === "cart-add") continue;
    if (role && role !== wantedRole) continue;

    const text =
      (htmlEl.textContent ?? "") +
      " " +
      (htmlEl.getAttribute("value") ?? "") +
      " " +
      (htmlEl.getAttribute("aria-label") ?? "") +
      " " +
      (htmlEl.getAttribute("title") ?? "");

    if (surface === "immediate_buy") {
      if (labelMatches(text, CART_ADD_LABELS)) continue;
      // Immediate buy: require strong immediate-buy wording, not generic 購入する
      // alone (FANZA product pages use 購入する near both cart and buy).
      if (
        labelMatches(text, ["即購入", "すぐに購入", "今すぐ購入", "Buy now", "Buy Now"]) ||
        role === "immediate-buy"
      ) {
        found.add(htmlEl);
      }
      continue;
    }

    // Cart / purchase-progress: block progression labels; still skip cart-add.
    if (labelMatches(text, CART_ADD_LABELS)) continue;
    if (labelMatches(text, PROGRESS_LABELS) || role === wantedRole) {
      found.add(htmlEl);
    }
  }

  return [...found];
}
