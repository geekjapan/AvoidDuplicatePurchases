import type { LookupHit, LookupOtherHit } from "./types.js";
import { queryFirst } from "./dom-utils.js";
import { ensureDisplayStyles } from "./styles.js";

const SOURCE_LABELS: Record<string, string> = {
  dlsite: "DLsite",
  fanza_doujin: "FANZA同人",
  fanza_books: "FANZAブックス",
  fanza_video: "FANZA動画",
  fanza_dlsoft: "FANZA PCゲーム",
};

/**
 * Source-specific HTTPS host + path validators for lookup-contract product URLs.
 * Only verified product page shapes from shared productUrlForSource are accepted.
 */
const SOURCE_URL_VALIDATORS: Record<string, (url: URL) => boolean> = {
  dlsite: (url) =>
    (url.hostname === "www.dlsite.com" || url.hostname === "play.dlsite.com") &&
    /^\/[a-z0-9_-]+\/work\/=\/product_id\/[A-Za-z0-9]+\.html$/i.test(url.pathname),
  fanza_doujin: (url) =>
    url.hostname === "www.dmm.co.jp" &&
    /^\/dc\/doujin\/-\/detail\/=\/cid=[^/]+\/?$/i.test(url.pathname),
  fanza_books: (url) =>
    url.hostname === "book.dmm.co.jp" &&
    /^\/product\/[^/]+\/[^/]+\/?$/.test(url.pathname),
  fanza_video: (url) =>
    url.hostname === "video.dmm.co.jp" &&
    /^\/(av|amateur)\/content\/?$/.test(url.pathname) &&
    Boolean(url.searchParams.get("id")?.trim()),
  fanza_dlsoft: (url) =>
    url.hostname === "dlsoft.dmm.co.jp" &&
    /^\/detail\/[^/]+\/?$/.test(url.pathname),
};

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

/**
 * Allow only https URLs that match the lookup-contract product shape for `source`.
 * Rejects non-https, unknown sources, and host/path mismatches.
 */
export function approvedStoreHttpsUrl(raw: string, source: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    const validate = SOURCE_URL_VALIDATORS[source];
    if (!validate || !validate(url)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** First cross-store hit whose URL is safe to render as a product link. */
export function selectRenderableOther(
  others: LookupOtherHit[],
): { other: LookupOtherHit; safeUrl: string } | null {
  for (const other of others) {
    const safeUrl = approvedStoreHttpsUrl(other.url, other.source);
    if (safeUrl) return { other, safeUrl };
  }
  return null;
}

export function renderProductBanner(doc: Document, hit: LookupHit): HTMLElement | null {
  if (hit.owned) {
    const banner = doc.createElement("div");
    banner.id = ADP_BANNER_ID;
    banner.className = "adp-purchased-banner adp-purchased-banner--owned";
    banner.textContent = formatOwnedBannerText(hit.purchasedAt);
    return banner;
  }

  const selected = selectRenderableOther(hit.other);
  const possible = selected ? null : selectRenderableOther(hit.possible ?? []);
  if (!selected && !possible) return null;
  const isPossible = !selected;
  const { other, safeUrl } = selected ?? possible!;

  const banner = doc.createElement("div");
  banner.id = ADP_BANNER_ID;
  banner.className = `adp-purchased-banner adp-purchased-banner--${isPossible ? "possible" : "other"}`;

  banner.appendChild(
    doc.createTextNode(isPossible ? "? 同一作品の可能性あり: " : "⚠ 他サイトで購入済み: "),
  );
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
