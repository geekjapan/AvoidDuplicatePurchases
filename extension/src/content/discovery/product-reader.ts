import type {
  DiscoveryProductReply,
  DiscoverySource,
} from "../../messages.js";
import { extractProductMeta } from "../meta.js";
import { extractVisiblePriceTiers } from "../price-observation.js";
import { classifyDisplayPage } from "../page-kind.js";
import { isVisible, visibleTextOf } from "../dom-visibility.js";

function safePageUrl(pageUrl: string): string {
  try {
    const url = new URL(pageUrl);
    if (url.protocol !== "https:") return "";
    if (url.username !== "" || url.password !== "") return "";
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

function detectAgeGate(doc: Document, pageUrl: string): boolean {
  try {
    if (/age_check/i.test(new URL(pageUrl).pathname)) return true;
  } catch {
    // ignore
  }
  const title = (doc.title ?? "").trim();
  if (/年齢認証|年齢確認/.test(title)) return true;
  const bodyText = doc.body ? visibleTextOf(doc.body).slice(0, 500) : "";
  return /このページはアダルト/.test(bodyText) && /年齢認証/.test(bodyText);
}

function detectLogin(doc: Document, pageUrl: string): boolean {
  try {
    const path = new URL(pageUrl).pathname;
    if (/\/login|\/my\//i.test(path)) return true;
  } catch {
    // ignore
  }
  const title = (doc.title ?? "").trim();
  return /ログイン/.test(title);
}

/**
 * Read counterpart product page: verify expected CID, then extract visible
 * three-tier prices once without coupon/cart mutation.
 */
export function readDiscoveryProductPage(
  targetSource: DiscoverySource,
  expectedCid: string,
  doc: Document,
  pageUrl: string,
): DiscoveryProductReply {
  const safe = safePageUrl(pageUrl) || pageUrl;

  if (detectAgeGate(doc, pageUrl)) {
    return { ok: true, state: "age_gate", pageUrl: safe };
  }
  if (detectLogin(doc, pageUrl)) {
    return { ok: true, state: "login", pageUrl: safe };
  }

  let pathname = "";
  try {
    pathname = new URL(pageUrl).pathname;
  } catch {
    return { ok: true, state: "page_not_ready", pageUrl: safe };
  }

  const kind = classifyDisplayPage(targetSource, pathname);
  if (kind !== "product") {
    return { ok: true, state: "page_not_ready", pageUrl: safe };
  }

  const meta = extractProductMeta(targetSource, doc);
  if (!meta) {
    // Product path but meta not yet hydrated.
    return { ok: true, state: "page_not_ready", pageUrl: safe };
  }

  const expected = expectedCid.trim().toUpperCase();
  const actual = meta.cid.trim().toUpperCase();
  if (actual !== expected) {
    return { ok: true, state: "mismatch", pageUrl: safe, cid: meta.cid };
  }

  // Never click coupons or mutate the cart; visible tiers only.
  const tiers = extractVisiblePriceTiers(targetSource, doc);
  // Guard: if body is not yet visible, treat as not ready.
  if (doc.body && !isVisible(doc.body) && !tiers.regular && !tiers.sale && !tiers.coupon) {
    return { ok: true, state: "page_not_ready", pageUrl: safe };
  }

  return {
    ok: true,
    state: "ready",
    pageUrl: safe,
    cid: meta.cid,
    title: meta.title,
    maker: meta.maker,
    tiers: {
      regular: tiers.regular,
      sale: tiers.sale,
      coupon: tiers.coupon,
    },
  };
}
