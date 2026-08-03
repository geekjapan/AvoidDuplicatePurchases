import type { LookupHit } from "./types.js";
import { queryFirst } from "./dom-utils.js";
import { ensureDisplayStyles } from "./styles.js";

const SOURCE_LABELS: Record<string, string> = {
  dlsite: "DLsite",
  fanza_doujin: "FANZA同人",
  fanza_books: "FANZAブックス",
};

/** HTTPS product hosts allowed for cross-store warning links. */
const APPROVED_STORE_HOSTS = new Set([
  "www.dlsite.com",
  "play.dlsite.com",
  "www.dmm.co.jp",
  "book.dmm.co.jp",
]);

export const ADP_BANNER_ID = "adp-purchased-banner";

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

/** Format stored purchase timestamp as YYYY-MM-DD when parseable. */
export function formatPurchaseDate(purchasedAt?: string | null): string | null {
  if (!purchasedAt) return null;
  const trimmed = purchasedAt.trim();
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed)?.[1];
  if (day) return day;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

/** Approved indicator: date when available, plain owned label otherwise. */
export function formatOwnedBannerText(purchasedAt?: string | null): string {
  const day = formatPurchaseDate(purchasedAt);
  if (day) return `✓ 購入済み(${day})`;
  return "✓ 購入済み";
}

/** Allow only https URLs on approved store hosts. */
export function approvedStoreHttpsUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (!APPROVED_STORE_HOSTS.has(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function renderProductBanner(doc: Document, hit: LookupHit): HTMLElement | null {
  if (hit.owned) {
    const banner = doc.createElement("div");
    banner.id = ADP_BANNER_ID;
    banner.className = "adp-purchased-banner adp-purchased-banner--owned";
    banner.textContent = formatOwnedBannerText(hit.purchasedAt);
    return banner;
  }

  const other = hit.other[0];
  if (!other) return null;
  const safeUrl = approvedStoreHttpsUrl(other.url);
  if (!safeUrl) return null;

  const banner = doc.createElement("div");
  banner.id = ADP_BANNER_ID;
  banner.className = "adp-purchased-banner adp-purchased-banner--other";

  banner.appendChild(doc.createTextNode("⚠ 他サイトで購入済み: "));
  const link = doc.createElement("a");
  link.href = safeUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = `${sourceLabel(other.source)}『${other.title}』`;
  banner.appendChild(link);
  return banner;
}

export function mountProductBanner(doc: Document, hit: LookupHit): void {
  if (doc.getElementById(ADP_BANNER_ID)) return;
  ensureDisplayStyles(doc);
  const banner = renderProductBanner(doc, hit);
  if (!banner) return;
  const anchor =
    queryFirst(doc, [".work_buy", "#work_buy", ".btn_work_buy", ".m-productPurchase"]) ??
    doc.querySelector("main") ??
    doc.body;
  anchor.insertAdjacentElement("afterbegin", banner);
}
