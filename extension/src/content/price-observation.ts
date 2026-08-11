import type { InterventionSource, Money } from "@adp/shared";
import { isVisible, visibleTextOf } from "./dom-visibility.js";

export type ObservedPriceTiers = {
  regular: Money | null;
  sale: Money | null;
  coupon: Money | null;
};

/**
 * One complete yen amount token only.
 * - Suffix form: `<amount>円` (optional spaces before 円)
 * - Prefix form: `JPY` / `￥` / `¥` then amount
 * Amount is either ungrouped digits or valid 3-digit groups (`1,100`).
 * Boundaries reject partials inside malformed strings such as `11,00円`,
 * `¥1.2`, or `1,10,000円`.
 */
const YEN_AMOUNT_TOKEN =
  "(?:[1-9]\\d{0,2}(?:,\\d{3})+|0|[1-9]\\d*)";
const YEN_AMOUNT_RE = new RegExp(
  `(?<![\\d,.])(${YEN_AMOUNT_TOKEN})\\s*円(?![\\d,.])|(?:JPY|￥|¥)\\s*(${YEN_AMOUNT_TOKEN})(?![\\d,.])`,
  "i",
);

const DLSITE_REGULAR_LABELS = [
  "サークル設定価格",
  "価格：",
  "価格:",
  "価格 ：",
  "価格 :",
] as const;
// Public DLsite markup uses the bare text `価格`; the rendered colon may come
// from translation/presentation. Keep this exact-only so `価格比較` and other
// unrelated page copy cannot become a regular-price label.
const DLSITE_REGULAR_EXACT_LABELS = ["価格"] as const;
const DLSITE_SALE_LABELS = ["セール特価", "セール価格", "キャンペーン価格"] as const;
const DLSITE_COUPON_LABELS = [
  "一番お得なクーポン利用価格",
  "クーポン適用時",
  "クーポン利用価格",
] as const;
const DMM_REGULAR_LABELS = ["サークル設定価格"] as const;
const DMM_SALE_LABELS = ["セール特価", "セール価格", "キャンペーン価格"] as const;
const DMM_COUPON_LABELS = [
  ...DLSITE_COUPON_LABELS,
  "一番お得なクーポン適用時",
  "クーポン適用価格",
  "クーポン利用時",
] as const;

/** Visible Japanese yen notation only; no FX. amountMinor is yen units. */
export function parseVisibleYenMoney(text: string): Money | null {
  const normalized = text.replace(/\u00a0/g, " ").trim();
  if (!normalized) return null;
  const matches = [...normalized.matchAll(new RegExp(YEN_AMOUNT_RE.source, "gi"))];
  if (matches.length !== 1) return null;
  const match = matches[0]!;
  // Fail closed when the sole match is only a substring of a larger numeric token.
  if (match.index === undefined) return null;
  const before = match.index > 0 ? normalized[match.index - 1]! : "";
  const afterIdx = match.index + match[0]!.length;
  const after = afterIdx < normalized.length ? normalized[afterIdx]! : "";
  if (/[\d,.]/.test(before) || /[\d,.]/.test(after)) return null;

  const raw = (match[1] ?? match[2] ?? "").replace(/,/g, "");
  if (!/^\d+$/.test(raw)) return null;
  // Reject leading-zero multi-digit amounts (e.g. partial "00" tokens).
  if (raw.length > 1 && raw.startsWith("0")) return null;
  const amountMinor = Number(raw);
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) return null;

  let taxStatus: Money["taxStatus"] = "unknown";
  if (normalized.includes("税込")) taxStatus = "included";
  else if (normalized.includes("税別")) taxStatus = "excluded";

  return { amountMinor, currency: "JPY", taxStatus };
}

function uniqueYenInText(text: string): Money | null {
  const normalized = text.replace(/\u00a0/g, " ");
  const matches = [...normalized.matchAll(new RegExp(YEN_AMOUNT_RE.source, "gi"))];
  if (matches.length !== 1) return null;
  return parseVisibleYenMoney(matches[0]![0]!);
}

function readTaxFrom(text: string, base: Money): Money {
  if (text.includes("税込")) return { ...base, taxStatus: "included" };
  if (text.includes("税別")) return { ...base, taxStatus: "excluded" };
  return base;
}

/** DMM/FANZA: scoped small price containers only (visible-dom decision). */
export function extractDmmFanzaPriceTiers(doc: Document): ObservedPriceTiers {
  const regularCandidates: Array<{ label: Element; amount: Element }> = [];
  const saleCandidates: Array<{ label: Element; amount: Element }> = [];

  for (const container of Array.from(doc.querySelectorAll(".priceContainer"))) {
    if (!isVisible(container)) continue;

    const ttls = Array.from(container.querySelectorAll(".priceList__ttl"));
    const mains = Array.from(container.querySelectorAll(".priceList__main"));
    for (const ttl of ttls) {
      if (!labelMatches(visibleTextOf(ttl), DMM_SALE_LABELS)) continue;
      for (const main of mains) saleCandidates.push({ label: ttl, amount: main });
    }

    const subs = Array.from(container.querySelectorAll(".priceList__sub"));
    const regularLabel = subs.find((sub) =>
      labelMatches(visibleTextOf(sub), DMM_REGULAR_LABELS),
    );
    const amounts = subs.filter((sub) => uniqueYenInText(visibleTextOf(sub)) !== null);
    if (regularLabel && amounts.length === 1) {
      regularCandidates.push({ label: regularLabel, amount: amounts[0]! });
    }
  }

  const couponCandidates: Array<{ label: Element; amount: Element }> = [];
  for (const root of Array.from(doc.querySelectorAll(".m-coupon__price"))) {
    if (!isVisible(root)) continue;
    const titles = Array.from(root.querySelectorAll(".m-coupon__price--title"));
    const mains = Array.from(root.querySelectorAll(".m-coupon__price--main"));
    for (const title of titles) {
      if (!labelMatches(visibleTextOf(title), DMM_COUPON_LABELS)) continue;
      for (const main of mains) couponCandidates.push({ label: title, amount: main });
    }
  }

  return {
    regular:
      regularCandidates.length > 0
        ? uniqueTierCandidate(regularCandidates)
        : findLabeledTier(doc, DMM_REGULAR_LABELS),
    sale:
      saleCandidates.length > 0
        ? uniqueTierCandidate(saleCandidates)
        : findLabeledTier(doc, DMM_SALE_LABELS),
    coupon:
      couponCandidates.length > 0
        ? uniqueTierCandidate(couponCandidates)
        : findLabeledTier(doc, DMM_COUPON_LABELS),
  };
}

function elementOwnText(el: Element): string {
  if (!isVisible(el)) return "";
  let own = "";
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      own += node.textContent ?? "";
    }
  }
  return own.replace(/\s+/g, " ").trim();
}

function labelMatches(text: string, labels: readonly string[]): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return false;
  return labels.some((label) => t === label || t.startsWith(label));
}

function labelEquals(text: string, labels: readonly string[]): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 0 && labels.some((label) => t === label);
}

function uniqueTierCandidate(
  candidates: Array<{ label: Element; amount: Element }>,
): Money | null {
  if (candidates.length !== 1) return null;
  const candidate = candidates[0]!;
  if (!isVisible(candidate.label) || !isVisible(candidate.amount)) return null;
  const parsed = uniqueYenInText(visibleTextOf(candidate.amount));
  return parsed
    ? readTaxFrom(`${visibleTextOf(candidate.label)} ${visibleTextOf(candidate.amount)}`, parsed)
    : null;
}

/**
 * DLsite: label-driven, fail-closed. Accept a tier only with one unambiguous
 * nearby visible yen amount. No provider-specific hidden selectors.
 */
export function extractDlsitePriceTiers(doc: Document): ObservedPriceTiers {
  return {
    regular: findLabeledTier(
      doc,
      DLSITE_REGULAR_LABELS,
      DLSITE_REGULAR_EXACT_LABELS,
    ),
    sale: findLabeledTier(doc, DLSITE_SALE_LABELS),
    coupon: findLabeledTier(doc, DLSITE_COUPON_LABELS),
  };
}

function findLabeledTier(
  doc: Document,
  labels: readonly string[],
  exactOnlyLabels: readonly string[] = [],
): Money | null {
  const root = doc.body ?? doc.documentElement ?? doc;
  const all = Array.from(root.querySelectorAll("*"));
  const candidates: Money[] = [];

  for (const el of all) {
    // Prefer own text, but accept rendered descendant text for storefronts that
    // wrap the visible label in an inner span. Wrapper matches remain safe
    // because the nearby scope must contain exactly one visible yen amount.
    const own = elementOwnText(el);
    const rendered = visibleTextOf(el);
    if (
      !labelMatches(own, labels) &&
      !labelEquals(own, exactOnlyLabels) &&
      !labelEquals(rendered, labels) &&
      !labelEquals(rendered, exactOnlyLabels)
    ) {
      continue;
    }

    // Nearby amount: parent row, immediate siblings, then the label node itself.
    const scopes: Element[] = [];
    if (el.parentElement) scopes.push(el.parentElement);
    const next = el.nextElementSibling;
    if (next) scopes.push(next);
    const prev = el.previousElementSibling;
    if (prev) scopes.push(prev);
    scopes.push(el);

    for (const scope of scopes) {
      if (!isVisible(scope)) continue;
      const money = uniqueYenInText(visibleTextOf(scope));
      if (money) {
        candidates.push(readTaxFrom(visibleTextOf(scope), money));
        break;
      }
    }
  }

  // Fail-closed: require exactly one distinct amount across matching labels.
  if (candidates.length === 0) return null;
  const key = (m: Money) => `${m.amountMinor}|${m.currency}|${m.taxStatus}`;
  const unique = new Map(candidates.map((m) => [key(m), m]));
  if (unique.size !== 1) return null;
  return [...unique.values()][0]!;
}

export function extractVisiblePriceTiers(
  source: InterventionSource,
  doc: Document,
): ObservedPriceTiers {
  if (source === "dlsite") return extractDlsitePriceTiers(doc);
  return extractDmmFanzaPriceTiers(doc);
}

/** True when at least one tier was observed (avoid empty no-op posts). */
export function hasAnyTier(tiers: ObservedPriceTiers): boolean {
  return tiers.regular !== null || tiers.sale !== null || tiers.coupon !== null;
}
