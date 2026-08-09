import type { LibraryDomItem, LibraryPageReply } from "../messages.js";
import type { LibraryPageReader } from "./library.js";
import { isVisible, visibleTextOf } from "./dom-visibility.js";

const AMAZON_BOOKS_PATH = "/hz/mycd/digital-console/contentlist/booksAll";
/** Amazon catalogue ASIN: exactly 10 upper-case alphanumeric characters. */
const ASIN_PATTERN = /^[A-Z0-9]{10}$/;
/** Visible acquisition-date prefix; anything else stays non-purchased. */
const ACQUIRED_PREFIX = "取得日:";
const RENTAL_PREFIX = "レンタル日:";
/** Amazon product-detail link shape (never synthesized from an ASIN). */
const PRODUCT_LINK_PATH = /^\/(?:dp|gp\/(?:product|aw\/d))\/([A-Za-z0-9]{10})\/?$/i;

/** Minimal visible-DOM view; satisfied by both `Document` and the test MockDocument. */
interface AmazonLibraryElement {
  id: string;
  textContent: string | null;
  getAttribute(name: string): string | null;
  querySelector(selector: string): AmazonLibraryElement | null;
  querySelectorAll(selector: string): ArrayLike<AmazonLibraryElement>;
  closest(selector: string): AmazonLibraryElement | null;
}

interface AmazonLibraryDocument {
  getElementById(id: string): AmazonLibraryElement | null;
  querySelectorAll(selector: string): ArrayLike<AmazonLibraryElement>;
}

/**
 * URL gate: HTTPS www.amazon.co.jp Books content-list path with an optional
 * positive `pageNumber` query. Other query values (Amazon tracking/sort) do
 * not move the tab off the library page, so they pass the gate but are
 * canonicalized away from every emitted page URL.
 */
export function isAmazonLibraryPageUrl(pageUrl: string): boolean {
  try {
    const url = new URL(pageUrl);
    const pageNumber = url.searchParams.get("pageNumber");
    return (
      url.protocol === "https:" &&
      url.hostname === "www.amazon.co.jp" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      (url.pathname === AMAZON_BOOKS_PATH ||
        url.pathname === `${AMAZON_BOOKS_PATH}/`) &&
      (pageNumber === null || /^[1-9]\d*$/.test(pageNumber))
    );
  } catch {
    return false;
  }
}

function pageNumberFromUrl(pageUrl: string): number | null {
  const value = new URL(pageUrl).searchParams.get("pageNumber");
  if (value === null) return null;
  const pageNumber = Number(value);
  return Number.isSafeInteger(pageNumber) && pageNumber > 0 ? pageNumber : null;
}

/** Canonical page URL: same path, only the `pageNumber` query preserved. */
function canonicalPageUrl(url: URL): string {
  const pageNumber = url.searchParams.get("pageNumber");
  return pageNumber === null
    ? `${url.origin}${url.pathname}`
    : `${url.origin}${url.pathname}?pageNumber=${pageNumber}`;
}

/**
 * ASIN from a title id. Bulk-dialog checkboxes (`<ASIN>:KindleEBook`) and any
 * other malformed id suffix fail the exact 10-char pattern and are ignored.
 */
function asinFromTitleId(id: string): string | null {
  if (!id.startsWith("content-title-")) return null;
  const asin = id.slice("content-title-".length);
  return ASIN_PATTERN.test(asin) ? asin : null;
}

function firstVisible(
  elements: ArrayLike<AmazonLibraryElement>,
): AmazonLibraryElement | null {
  return Array.from(elements).find((element) => isVisible(element)) ?? null;
}

function visibleDescendant(
  root: AmazonLibraryElement,
  selector: string,
): AmazonLibraryElement | null {
  return firstVisible(root.querySelectorAll(selector));
}

function visibleDocumentElementById(
  doc: AmazonLibraryDocument,
  id: string,
): AmazonLibraryElement | null {
  return firstVisible(doc.querySelectorAll(`#${id}`));
}

function textOf(element: AmazonLibraryElement | null | undefined): string {
  return element === null || element === undefined ? "" : visibleTextOf(element).trim();
}

function isDisabled(element: AmazonLibraryElement): boolean {
  if (element.getAttribute("aria-disabled")?.toLowerCase() === "true") return true;
  if (element.getAttribute("disabled") !== null) return true;
  return /\bdisabled\b/i.test(element.getAttribute("class") ?? "");
}

/**
 * Free markers (visible free / 無料). Distinct from an explicit purchased
 * zero-price row, which carries 取得日 without these markers.
 */
const FREE_MARKER_RE = /無料|\bfree\b/i;
/**
 * Returned / refunded markers. No dedicated state exists; fail closed to
 * unknown so they never become owned listings.
 */
const RETURNED_MARKER_RE = /返品|返金|returned|refunded/i;
/**
 * Other non-purchase / ambiguous markers that must win over acquisition-date
 * evidence when they appear on the same row (fail closed).
 */
const CONFLICTING_NON_PURCHASE_RE =
  /Prime\s*Reading|Kindle\s*Unlimited|\bKU\b|サンプル|sample|試し読み|trial|読み放題|サブスク|subscription|レンタル日:/i;

/**
 * Visible acquisition evidence → explicit state.
 * Order is fail-closed: rental action / rental date first, then free,
 * returned/refunded, other non-purchase or ambiguous markers, and only then
 * `取得日:` → purchased. Free/returned win over acquisition date on the same
 * row. Explicit purchased zero-price evidence (取得日 alone) stays purchased.
 * Ownership is never inferred from the title or row presence alone.
 */
function stateFromVisibleEvidence(
  row: AmazonLibraryElement,
  asin: string,
): LibraryDomItem["state"] {
  if (visibleDescendant(row, `#RETURN_CONTENT_ACTION_${asin}`)) return "rental";
  const label = textOf(visibleDescendant(row, `#content-acquired-date-${asin}`));
  const rowText = textOf(row);
  if (label.startsWith(RENTAL_PREFIX) || /レンタル日:/.test(rowText)) return "rental";
  // Free / returned / ambiguous markers take precedence over 取得日.
  if (FREE_MARKER_RE.test(label) || FREE_MARKER_RE.test(rowText)) return "free";
  if (RETURNED_MARKER_RE.test(label) || RETURNED_MARKER_RE.test(rowText)) {
    return "unknown";
  }
  if (CONFLICTING_NON_PURCHASE_RE.test(rowText)) return "unknown";
  if (label.startsWith(ACQUIRED_PREFIX)) return "purchased";
  return "unknown";
}

/** Keep a visible image only when its src is an absolute http(s) URL without credentials. */
function imageUrlOf(row: AmazonLibraryElement): string | null {
  for (const image of Array.from(row.querySelectorAll("img"))) {
    if (!isVisible(image)) continue;
    const src = image.getAttribute("src");
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

/**
 * Preserve a productUrl only when the row contains a real visible HTTPS
 * product-detail link; never invent an Amazon URL from an ASIN.
 */
function productUrlOf(row: AmazonLibraryElement, asin: string): string | null {
  for (const anchor of Array.from(row.querySelectorAll("a"))) {
    if (!isVisible(anchor)) continue;
    const href = anchor.getAttribute("href");
    if (!href) continue;
    try {
      const url = new URL(href);
      if (
        url.protocol === "https:" &&
        url.hostname === "www.amazon.co.jp" &&
        url.port === "" &&
        url.username === "" &&
        url.password === "" &&
        (() => {
          const match = PRODUCT_LINK_PATH.exec(url.pathname);
          return match !== null && match[1]!.toUpperCase() === asin;
        })()
      ) {
        const path = url.pathname.endsWith("/")
          ? url.pathname.slice(0, -1)
          : url.pathname;
        return `${url.origin}${path.replace(/[^/]+$/, asin)}`;
      }
    } catch {
      // relative or malformed link is not an absolute HTTPS product link
    }
  }
  return null;
}

function buildItems(doc: AmazonLibraryDocument): LibraryDomItem[] {
  const seen = new Set<string>();
  const items: LibraryDomItem[] = [];
  for (const titleEl of Array.from(doc.querySelectorAll('[id^="content-title-"]'))) {
    const asin = asinFromTitleId(titleEl.id);
    if (asin === null || seen.has(asin) || !isVisible(titleEl)) continue;
    const row = titleEl.closest("tr");
    if (!row || !isVisible(row)) continue;
    const title = textOf(titleEl);
    if (!title) continue;

    seen.add(asin);
    const item: LibraryDomItem = {
      cid: asin,
      title,
      state: stateFromVisibleEvidence(row, asin),
    };
    const author = textOf(visibleDescendant(row, `#content-author-${asin}`));
    if (author) item.maker = author;
    const imageUrl = imageUrlOf(row);
    if (imageUrl) item.imageUrl = imageUrl;
    const productUrl = productUrlOf(row, asin);
    if (productUrl) item.productUrl = productUrl;
    items.push(item);
  }
  return items;
}

/** A later page exists only when the visible pager proves it. */
function hasLaterVisiblePage(
  doc: AmazonLibraryDocument,
  currentPageNumber: number,
): boolean {
  const pagination = visibleDocumentElementById(doc, "pagination");
  if (!pagination) return false;
  const next = visibleDescendant(pagination, '#page-RIGHT_PAGE[aria-label="Next"]');
  if (next && !isDisabled(next)) return true;
  for (const anchor of Array.from(pagination.querySelectorAll('[id^="page-"]'))) {
    if (!isVisible(anchor) || isDisabled(anchor)) continue;
    const pageNumber = Number(anchor.id.slice("page-".length));
    if (Number.isSafeInteger(pageNumber) && pageNumber > currentPageNumber) {
      return true;
    }
  }
  return false;
}

/** Next URL on the existing `?pageNumber=` route; bounded by the visible pager. */
function nextPageUrlOf(
  doc: AmazonLibraryDocument,
  pageUrl: string,
): string | null {
  const currentPageNumber = pageNumberFromUrl(pageUrl) ?? 1;
  if (!hasLaterVisiblePage(doc, currentPageNumber)) return null;
  const next = new URL(pageUrl);
  next.search = "";
  next.searchParams.set("pageNumber", String(currentPageNumber + 1));
  return canonicalPageUrl(next);
}

export function readAmazonLibraryPage(
  doc: unknown,
  pageUrl: string,
): LibraryPageReply {
  if (!isAmazonLibraryPageUrl(pageUrl)) {
    return { ok: true, state: "login", pageUrl };
  }
  const canonical = canonicalPageUrl(new URL(pageUrl));
  const pageDoc = doc as AmazonLibraryDocument;
  const items = buildItems(pageDoc);

  const countText = textOf(visibleDocumentElementById(pageDoc, "CONTENT_COUNT"));
  const total = /^(\d+)のうち/.exec(countText)?.[1];

  // Count and rows both missing: the library shell is still loading.
  if (!total && items.length === 0) {
    return { ok: true, state: "page_not_ready", pageUrl: canonical };
  }
  if (total === "0") {
    return { ok: true, state: "empty", pageUrl: canonical, items: [], nextPageUrl: null };
  }
  // Count claims items but no visible row matches: fail closed rather than
  // reporting a partial or invented batch.
  if (items.length === 0) {
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

export const amazonLibraryPageReader: LibraryPageReader = {
  source: "amazon",
  matchesLibraryUrl: isAmazonLibraryPageUrl,
  readPage: readAmazonLibraryPage,
};
