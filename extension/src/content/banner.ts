import type { LookupHit } from "./types.js";
import { queryFirst } from "./dom-utils.js";
import { ensureDisplayStyles } from "./styles.js";

const SOURCE_LABELS: Record<string, string> = {
  dlsite: "DLsite",
  fanza_doujin: "FANZA同人",
  fanza_books: "FANZAブックス",
};

export const ADP_BANNER_ID = "adp-purchased-banner";

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

export function formatOwnedBannerText(): string {
  return "✓ 購入済み";
}

export function formatOtherBannerHtml(hit: LookupHit): string | null {
  const other = hit.other[0];
  if (!other) return null;
  const label = sourceLabel(other.source);
  const safeTitle = other.title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeUrl = other.url.replace(/"/g, "&quot;");
  return `⚠ 他サイトで購入済み: <a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}『${safeTitle}』</a>`;
}

export function renderProductBanner(doc: Document, hit: LookupHit): HTMLElement | null {
  if (hit.owned) {
    const banner = doc.createElement("div");
    banner.id = ADP_BANNER_ID;
    banner.className = "adp-purchased-banner adp-purchased-banner--owned";
    banner.textContent = formatOwnedBannerText();
    return banner;
  }
  const html = formatOtherBannerHtml(hit);
  if (!html) return null;
  const banner = doc.createElement("div");
  banner.id = ADP_BANNER_ID;
  banner.className = "adp-purchased-banner adp-purchased-banner--other";
  banner.innerHTML = html;
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
