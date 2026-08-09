import type { LibraryDomItem, LibraryPageReply } from "../messages.js";
import { isVisible, visibleTextOf } from "./dom-visibility.js";
import type { LibraryPageReader } from "./library.js";

const KOBO_HOST = "books.rakuten.co.jp";
const LIBRARY_BASE = "/e-book/kobo/library";
/** Visible product path; opaque id is the provisional cid (research #46). */
const PRODUCT_PATH = /^\/rk\/([A-Za-z0-9_-]+)\/?$/;
const PAGE_PATH = new RegExp(`^${LIBRARY_BASE}/page/([1-9]\\d*)/?$`);
const ACTIVE_CLASS = /\b(?:is-)?(?:active|current|selected)\b/i;
const PURCHASED_TITLE_MARKER = "kobo_pc_mylibrary_purchased_book_title";
const PURCHASED_SERIES_MARKER = "kobo_pc_mylibrary_purchased_book_series";
const NON_PURCHASED_MARKERS: Array<{ re: RegExp; state: LibraryDomItem["state"] }> = [
  { re: /プレビュー|preview/i, state: "preview" },
  { re: /立ち読み|試し読み|サンプル|sample|trial/i, state: "sample" },
  { re: /Kobo\s*Plus|読み放題|サブスク|subscription/i, state: "subscription" },
  { re: /予約/, state: "reservation" },
  { re: /無料/, state: "free" },
  { re: /期間限定/, state: "unknown" },
];

/** Minimal visible-DOM view; satisfied by both `Document` and the test MockDocument. */
interface KoboElement {
  className: string;
  textContent: string | null;
  getAttribute(name: string): string | null;
  querySelector(selector: string): KoboElement | null;
  querySelectorAll(selector: string): ArrayLike<KoboElement>;
}

interface KoboDocument {
  querySelector(selector: string): KoboElement | null;
  querySelectorAll(selector: string): ArrayLike<KoboElement>;
}

function hasClass(el: KoboElement, name: string): boolean {
  return el.className.split(/\s+/).includes(name);
}

function visibleDescendant(
  root: KoboElement,
  selector: string,
): KoboElement | null {
  return (
    Array.from(root.querySelectorAll(selector)).find((candidate) => isVisible(candidate)) ??
    null
  );
}

function textOf(el: KoboElement | null | undefined): string {
  if (!el || !isVisible(el)) return "";
  return visibleTextOf(el).trim();
}

function normalizedPath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

function libraryPageNumber(pathname: string): number | null {
  const path = normalizedPath(pathname);
  if (path === LIBRARY_BASE) return 1;
  const match = PAGE_PATH.exec(path);
  if (!match) return null;
  const page = Number(match[1]);
  return Number.isSafeInteger(page) && page > 0 ? page : null;
}

/**
 * URL gate: HTTPS books.rakuten.co.jp library path, optionally
 * `/page/<positive>`. Temporary auth/tracking query or hash values
 * (e.g. `code=REDACTED` after a provider redirect) are accepted only to
 * recognize the visible library page; they are stripped from every returned
 * and persisted URL, and next-page links must be canonical paths.
 */
export function isKoboLibraryPageUrl(pageUrl: string): boolean {
  try {
    const url = new URL(pageUrl);
    return (
      url.protocol === "https:" &&
      url.hostname === KOBO_HOST &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      libraryPageNumber(url.pathname) !== null
    );
  } catch {
    return false;
  }
}

/**
 * Canonical page URL: origin + pathname only (no query/hash). Temporary
 * auth/tracking values from the visible URL never survive this boundary.
 */
function canonicalPageUrl(url: URL): string {
  const page = libraryPageNumber(url.pathname) ?? 1;
  return page === 1
    ? `${url.origin}${LIBRARY_BASE}/`
    : `${url.origin}${LIBRARY_BASE}/page/${page}`;
}

function isActiveControl(el: KoboElement): boolean {
  if (!isVisible(el)) return false;
  if (el.getAttribute("aria-selected") === "true") return true;
  const current = el.getAttribute("aria-current");
  if (current === "page" || current === "true") return true;
  if (ACTIVE_CLASS.test(el.className)) return true;
  return false;
}

type LibraryView = "purchased" | "sample" | "unknown";

/**
 * Selected マイライブラリ view. Only the visible 追加した書籍 view maps to
 * purchased; 立ち読み版 never upgrades. Missing/ambiguous selection stays
 * unknown unless purchased-title link markers prove the default list.
 */
function activeLibraryView(doc: KoboDocument): LibraryView {
  let purchasedActive = false;
  let sampleActive = false;
  for (const el of Array.from(doc.querySelectorAll("a")).concat(
    Array.from(doc.querySelectorAll("button")),
    Array.from(doc.querySelectorAll("li")),
    Array.from(doc.querySelectorAll("span")),
  )) {
    if (!isVisible(el)) continue;
    const label = textOf(el);
    if (!label) continue;
    if (label.includes("追加した書籍") && isActiveControl(el)) purchasedActive = true;
    if (label.includes("立ち読み版") && isActiveControl(el)) sampleActive = true;
  }
  if (purchasedActive && !sampleActive) return "purchased";
  if (sampleActive && !purchasedActive) return "sample";
  if (purchasedActive && sampleActive) return "unknown";

  // Default list evidence: title links carry the purchased marker query.
  for (const anchor of Array.from(doc.querySelectorAll("a"))) {
    if (!isVisible(anchor)) continue;
    const href = anchor.getAttribute("href");
    if (href && href.includes(PURCHASED_TITLE_MARKER)) return "purchased";
  }
  return "unknown";
}

function hasLibraryShell(doc: KoboDocument): boolean {
  for (const heading of Array.from(doc.querySelectorAll("h1"))) {
    if (!isVisible(heading)) continue;
    if (textOf(heading).includes("マイライブラリ")) return true;
  }
  return false;
}

function isEmptyPurchasedView(doc: KoboDocument): boolean {
  // Explicit empty copy, or a zero count next to the purchased-view label.
  for (const el of Array.from(doc.querySelectorAll("div")).concat(
    Array.from(doc.querySelectorAll("p")),
    Array.from(doc.querySelectorAll("span")),
  )) {
    if (!isVisible(el)) continue;
    const text = textOf(el);
    if (!text) continue;
    if (/追加した書籍/.test(text) && /(?:^|[^\d])0(?:\s*件)?$/.test(text)) return true;
    if (text.includes("追加した書籍") && text.includes("0件")) return true;
    if (/本がありません|まだ本がありません|書籍がありません/.test(text)) return true;
  }
  return false;
}

/** Keep a visible image only when its src is an absolute http(s) URL without credentials. */
function imageUrlOf(root: KoboElement): string | null {
  for (const img of Array.from(root.querySelectorAll("img"))) {
    if (!isVisible(img)) continue;
    const src = img.getAttribute("src");
    if (!src) continue;
    try {
      const url = new URL(src);
      if (
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.port === "" &&
        url.username === "" &&
        url.password === ""
      ) {
        return url.href;
      }
    } catch {
      // relative or malformed src is not an absolute URL
    }
  }
  return null;
}

function isDownloadOrDrmHref(href: string): boolean {
  return /download|adobe|drm|acs\.|adept/i.test(href);
}

/**
 * Visible HTTPS product link only. Download / Adobe DRM / credentialed /
 * non-product hrefs are ignored; the product path is never invented.
 */
function productFromHref(
  href: string,
  pageUrl: string,
): { cid: string; productUrl: string } | null {
  if (isDownloadOrDrmHref(href)) return null;
  let url: URL;
  try {
    url = new URL(href, pageUrl);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== KOBO_HOST ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    return null;
  }
  const match = PRODUCT_PATH.exec(url.pathname);
  if (!match) return null;
  const cid = match[1]!;
  const path = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  return { cid, productUrl: `${url.origin}${path}` };
}

function stateFromVisibleEvidence(
  root: KoboElement,
  view: LibraryView,
): LibraryDomItem["state"] {
  if (view === "sample") return "sample";
  const blob = textOf(root);
  for (const marker of NON_PURCHASED_MARKERS) {
    if (marker.re.test(blob)) return marker.state;
  }
  if (view === "purchased") return "purchased";
  return "unknown";
}

function seriesOf(info: KoboElement, pageUrl: string): string | null {
  for (const anchor of Array.from(info.querySelectorAll("a"))) {
    if (!isVisible(anchor)) continue;
    const href = anchor.getAttribute("href") ?? "";
    const label = textOf(anchor);
    if (!label) continue;
    // Prefer the observed purchased-series marker; otherwise a non-product
    // series control under the information block.
    if (href.includes(PURCHASED_SERIES_MARKER)) return label;
    if (productFromHref(href, pageUrl)) continue;
    if (/series|シリーズ/i.test(href) || /series|シリーズ/i.test(anchor.className)) {
      return label;
    }
  }
  return null;
}

/**
 * Item boundary = title link inside
 * li > .rb-item-wrapper.synced > .rb-information-wrapper > .title.
 * Only that title link may become productUrl.
 */
function buildItems(
  doc: KoboDocument,
  pageUrl: string,
  view: LibraryView,
): LibraryDomItem[] {
  const seen = new Set<string>();
  const items: LibraryDomItem[] = [];

  for (const li of Array.from(doc.querySelectorAll("li"))) {
    if (!isVisible(li)) continue;
    const wrappers = Array.from(li.querySelectorAll(".rb-item-wrapper"));
    const wrapper =
      wrappers.find((el) => isVisible(el) && hasClass(el, "synced")) ?? null;
    if (!wrapper) continue;
    const info = visibleDescendant(wrapper, ".rb-information-wrapper");
    if (!info) continue;
    const titleRoot = visibleDescendant(info, ".title");
    if (!titleRoot) continue;

    // Title link lives under .title > h1 (observed) or directly under .title.
    // Prefer visible h1 scopes, but fall back to the visible .title root when
    // no visible h1 exists so a hidden duplicate cannot mask a visible link.
    const titleScopes = Array.from(titleRoot.querySelectorAll("h1")).filter((el) =>
      isVisible(el),
    );
    const scopes = titleScopes.length > 0 ? titleScopes : [titleRoot];
    let product: { cid: string; productUrl: string } | null = null;
    let title = "";
    for (const scope of scopes) {
      for (const anchor of Array.from(scope.querySelectorAll("a"))) {
        if (!isVisible(anchor)) continue;
        const href = anchor.getAttribute("href");
        if (!href) continue;
        const found = productFromHref(href, pageUrl);
        if (!found) continue;
        product = found;
        title = textOf(anchor);
        break;
      }
      if (product) break;
    }
    if (!product || !title) continue;
    if (seen.has(product.cid)) continue;
    seen.add(product.cid);

    const item: LibraryDomItem = {
      cid: product.cid,
      title,
      state: stateFromVisibleEvidence(li, view),
      productUrl: product.productUrl,
    };
    const author = textOf(visibleDescendant(info, ".author"));
    if (author) item.maker = author;
    const series = seriesOf(info, pageUrl);
    if (series) item.seriesId = series;
    const imageUrl = imageUrlOf(li);
    if (imageUrl) item.imageUrl = imageUrl;
    items.push(item);
  }
  return items;
}

/**
 * Next URL only from a visible same-host library control
 * (`/e-book/kobo/library/page/N`). The href itself must prove the next page;
 * labels never cause a URL to be synthesized.
 */
function nextPageUrlOf(doc: KoboDocument, pageUrl: string): string | null {
  const currentPage = libraryPageNumber(new URL(pageUrl).pathname) ?? 1;
  let best: number | null = null;
  for (const anchor of Array.from(doc.querySelectorAll("a"))) {
    if (!isVisible(anchor)) continue;
    const href = anchor.getAttribute("href");
    if (!href) continue;
    let url: URL;
    try {
      url = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (
      url.protocol !== "https:" ||
      url.hostname !== KOBO_HOST ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      continue;
    }
    if (url.search !== "" || url.hash !== "") continue;
    const page = libraryPageNumber(url.pathname);
    if (page !== null && page > currentPage && (best === null || page < best)) {
      best = page;
    }
  }
  if (best === null) return null;
  return `${new URL(pageUrl).origin}${LIBRARY_BASE}/page/${best}`;
}

/**
 * Gate-failure login URL: HTTPS origin+pathname only. Auth/tracking query
 * values and credentials never leave the content-script boundary.
 */
function safeLoginPageUrl(pageUrl: string): string {
  try {
    const url = new URL(pageUrl);
    if (url.protocol !== "https:") return "";
    if (url.username !== "" || url.password !== "") return "";
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

export function readKoboLibraryPage(doc: unknown, pageUrl: string): LibraryPageReply {
  if (!isKoboLibraryPageUrl(pageUrl)) {
    return { ok: true, state: "login", pageUrl: safeLoginPageUrl(pageUrl) };
  }
  const canonical = canonicalPageUrl(new URL(pageUrl));
  const pageDoc = doc as KoboDocument;

  if (!hasLibraryShell(pageDoc)) {
    return { ok: true, state: "page_not_ready", pageUrl: canonical };
  }

  const view = activeLibraryView(pageDoc);
  if (view === "unknown") {
    // Shell present but no purchased/sample selection evidence: fail closed.
    return { ok: true, state: "page_not_ready", pageUrl: canonical };
  }

  if (view === "sample") {
    const sampleItems = buildItems(pageDoc, canonical, view);
    if (sampleItems.length === 0) {
      return {
        ok: true,
        state: isEmptyPurchasedView(pageDoc) ? "empty" : "ready",
        pageUrl: canonical,
        items: [],
        nextPageUrl: null,
      };
    }
    return {
      ok: true,
      state: "ready",
      pageUrl: canonical,
      items: sampleItems,
      nextPageUrl: nextPageUrlOf(pageDoc, canonical),
    };
  }

  if (isEmptyPurchasedView(pageDoc) && buildItems(pageDoc, canonical, view).length === 0) {
    return {
      ok: true,
      state: "empty",
      pageUrl: canonical,
      items: [],
      nextPageUrl: null,
    };
  }

  const items = buildItems(pageDoc, canonical, view);
  if (items.length === 0) {
    // No empty marker and no observed title-link boundary → fail closed.
    return { ok: true, state: "page_not_ready", pageUrl: canonical };
  }
  return {
    ok: true,
    state: "ready",
    pageUrl: canonical,
    items,
    nextPageUrl: nextPageUrlOf(pageDoc, canonical),
  };
}

export const koboLibraryPageReader: LibraryPageReader = {
  source: "kobo",
  matchesLibraryUrl: isKoboLibraryPageUrl,
  readPage: readKoboLibraryPage,
};
