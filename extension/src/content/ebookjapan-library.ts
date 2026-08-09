import type { LibraryDomItem, LibraryPageReply } from "../messages.js";
import type { LibraryPageReader } from "./library.js";
import { isVisible, visibleTextOf } from "./dom-visibility.js";

const EBOOKJAPAN_HOST = "ebookjapan.yahoo.co.jp";
const BOOKSHELF_PATH = "/bookshelf";
/** Public product path; cid is the trailing publicationCd (research #44). */
const PRODUCT_PATH = /^\/books\/\d+\/([A-Za-z0-9]+)\/?$/;
const ACTIVE_CLASS = /\b(?:is-)?(?:active|current|selected)\b/i;
const NON_PURCHASED_MARKERS: Array<{ re: RegExp; state: LibraryDomItem["state"] }> = [
  { re: /レンタル/, state: "rental" },
  { re: /立ち読み|試し読み|サンプル|trial|sample/i, state: "sample" },
  { re: /予約/, state: "reservation" },
  { re: /ギフト|プレゼント|gift/i, state: "gift" },
  { re: /読み放題|サブスク|subscription/i, state: "subscription" },
  { re: /無料/, state: "free" },
];

/** Minimal visible-DOM view; satisfied by both `Document` and the test MockDocument. */
interface EbookjapanElement {
  id: string;
  className: string;
  textContent: string | null;
  getAttribute(name: string): string | null;
  querySelector(selector: string): EbookjapanElement | null;
  querySelectorAll(selector: string): ArrayLike<EbookjapanElement>;
}

interface EbookjapanDocument {
  getElementById(id: string): EbookjapanElement | null;
  querySelector(selector: string): EbookjapanElement | null;
  querySelectorAll(selector: string): ArrayLike<EbookjapanElement>;
}

function hasClass(el: EbookjapanElement, name: string): boolean {
  return el.className.split(/\s+/).includes(name);
}

function visibleElements<T extends EbookjapanElement>(elements: ArrayLike<T>): T[] {
  return Array.from(elements).filter((element) => isVisible(element));
}

function firstVisible<T extends EbookjapanElement>(elements: ArrayLike<T>): T | null {
  return visibleElements(elements)[0] ?? null;
}

function textOf(el: EbookjapanElement | null | undefined): string {
  return el ? visibleTextOf(el).trim() : "";
}

/**
 * URL gate: HTTPS ebookjapan.yahoo.co.jp with the exact `/bookshelf` or
 * `/bookshelf/` path and either no query or a single positive `page` query.
 * Subpaths, non-page query keys, duplicate page values, tracking, hash, and
 * credentials fail closed.
 */
export function isEbookjapanLibraryPageUrl(pageUrl: string): boolean {
  try {
    const url = new URL(pageUrl);
    return (
      url.protocol === "https:" &&
      url.hostname === EBOOKJAPAN_HOST &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      isBookshelfPath(url.pathname) &&
      (url.search === "" || pageQueryValueOf(url) !== null)
    );
  } catch {
    return false;
  }
}

function pageFromUrl(pageUrl: string): number | null {
  const value = new URL(pageUrl).searchParams.get("page");
  if (value === null) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : null;
}

function isBookshelfPath(pathname: string): boolean {
  return pathname === BOOKSHELF_PATH || pathname === `${BOOKSHELF_PATH}/`;
}

/**
 * Single positive `page` query value, or null when the query is absent or
 * anything else (extra keys, duplicate values, non-positive values).
 */
function pageQueryValueOf(url: URL): string | null {
  if (url.search === "") return null;
  const values = url.searchParams.getAll("page");
  if (values.length !== 1 || !/^[1-9]\d*$/.test(values[0]!)) return null;
  for (const key of url.searchParams.keys()) {
    if (key !== "page") return null;
  }
  return values[0]!;
}

/**
 * Canonical page URL: origin + exact `/bookshelf/` with the single positive
 * `page` query the gate accepted. The gate never admits subpaths or extra
 * query keys, so canonicalization only normalizes the path suffix.
 */
function canonicalPageUrl(url: URL): string {
  const page = pageQueryValueOf(url);
  return page === null
    ? `${url.origin}${BOOKSHELF_PATH}/`
    : `${url.origin}${BOOKSHELF_PATH}/?page=${page}`;
}

function isActiveTab(el: EbookjapanElement): boolean {
  if (el.getAttribute("aria-selected") === "true") return true;
  const current = el.getAttribute("aria-current");
  if (current === "page" || current === "true") return true;
  if (ACTIVE_CLASS.test(el.className)) return true;
  return false;
}

type ShelfTab = "purchased" | "free_history" | "other" | "unknown";

/**
 * Active tab inside the observed `ul.tab-menu-list`. The purchased tab is the
 * only ownership evidence path; the separate free-reading tab never upgrades
 * to purchased. Missing/ambiguous active state stays unknown (fail closed).
 */
function activeShelfTab(doc: EbookjapanDocument): ShelfTab {
  const menu = firstVisible(doc.querySelectorAll(".tab-menu-list"));
  if (!menu) return "unknown";
  const tabs = [
    ...visibleElements(menu.querySelectorAll("li")),
    ...visibleElements(menu.querySelectorAll("a")),
  ];
  const active = tabs.find(isActiveTab);
  if (!active) return "unknown";
  const label = textOf(active);
  if (label.includes("購入済み")) return "purchased";
  if (label.includes("無料読書履歴")) return "free_history";
  return "other";
}

function visibleShelfOf(doc: EbookjapanDocument): EbookjapanElement | null {
  return (
    firstVisible(doc.querySelectorAll("#wd_temp_shelf-main")) ??
    firstVisible(doc.querySelectorAll(".contents-book-wrapper"))
  );
}

function hasBookshelfShell(doc: EbookjapanDocument): boolean {
  if (!firstVisible(doc.querySelectorAll("#wd_temp_shelf-main"))) return false;
  const heading = firstVisible(doc.querySelectorAll(".heading__main"));
  if (!heading || !textOf(heading)) return false;
  if (!firstVisible(doc.querySelectorAll(".tab-menu-list"))) return false;
  if (!firstVisible(doc.querySelectorAll(".shelf-control__amount"))) return false;
  return true;
}

function isEmptyPurchasedShelf(doc: EbookjapanDocument): boolean {
  for (const el of visibleElements(doc.querySelectorAll(".zero-message"))) {
    if (!hasClass(el, "zero-message--shelf")) continue;
    if (textOf(el).includes("本がありません")) return true;
  }
  return false;
}

/** Keep a visible image only when its src is an absolute http(s) URL without credentials. */
function imageUrlOf(root: EbookjapanElement): string | null {
  for (const img of visibleElements(root.querySelectorAll("img"))) {
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

function stateFromVisibleEvidence(
  root: EbookjapanElement,
  tab: ShelfTab,
): LibraryDomItem["state"] {
  if (tab === "free_history") return "free";
  const blob = textOf(root);
  for (const marker of NON_PURCHASED_MARKERS) {
    if (marker.re.test(blob)) return marker.state;
  }
  // Explicit purchased-tab shelf evidence only; title alone never owns.
  if (tab === "purchased") return "purchased";
  return "unknown";
}

/**
 * Item boundary = a real visible product link inside the purchased shelf
 * shell. publicationCd is the provisional cid (research #44). No private
 * endpoint / hidden JSON / invented URL is used; without such a link the
 * reader cannot establish a non-empty item boundary.
 */
function buildItems(
  doc: EbookjapanDocument,
  pageUrl: string,
  tab: ShelfTab,
): LibraryDomItem[] {
  const shelf = visibleShelfOf(doc);
  if (!shelf) return [];

  const seen = new Set<string>();
  const items: LibraryDomItem[] = [];
  for (const anchor of visibleElements(shelf.querySelectorAll("a"))) {
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
      url.hostname !== EBOOKJAPAN_HOST ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      continue;
    }
    const match = PRODUCT_PATH.exec(url.pathname);
    if (!match) continue;
    const cid = match[1]!;
    if (seen.has(cid)) continue;

    const title =
      textOf(anchor) ||
      visibleElements(anchor.querySelectorAll("img"))
        .map((img) => img.getAttribute("alt")?.trim() ?? "")
        .find(Boolean) ||
      "";
    if (!title) continue;

    seen.add(cid);
    const item: LibraryDomItem = {
      cid,
      title,
      state: stateFromVisibleEvidence(anchor, tab),
    };
    const imageUrl = imageUrlOf(anchor);
    if (imageUrl) item.imageUrl = imageUrl;
    // Preserve the actual visible HTTPS product link; never synthesize one.
    item.productUrl = `${url.origin}${url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`}`;
    items.push(item);
  }
  return items;
}

/**
 * Next URL only when a visible same-host bookshelf control proves a later
 * page. Accepts `?page=N` links or a control whose text is a next-page cue.
 */
function nextPageUrlOf(doc: EbookjapanDocument, pageUrl: string): string | null {
  const currentPage = pageFromUrl(pageUrl) ?? 1;
  let best: number | null = null;
  for (const anchor of visibleElements(doc.querySelectorAll("a"))) {
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
      url.hostname !== EBOOKJAPAN_HOST ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      continue;
    }
    if (!isBookshelfPath(url.pathname)) continue;
    const pageParam = pageQueryValueOf(url);
    const labeledNext = /次|next/i.test(textOf(anchor));
    if (pageParam !== null) {
      const n = Number(pageParam);
      if (n > currentPage && (best === null || n < best)) best = n;
    } else if (labeledNext && url.search === "") {
      const n = currentPage + 1;
      if (best === null || n < best) best = n;
    }
  }
  if (best === null) return null;
  const next = new URL(pageUrl);
  next.search = "";
  next.pathname = `${BOOKSHELF_PATH}/`;
  next.searchParams.set("page", String(best));
  return canonicalPageUrl(next);
}

export function readEbookjapanLibraryPage(
  doc: unknown,
  pageUrl: string,
): LibraryPageReply {
  if (!isEbookjapanLibraryPageUrl(pageUrl)) {
    return { ok: true, state: "login", pageUrl };
  }
  const canonical = canonicalPageUrl(new URL(pageUrl));
  const pageDoc = doc as EbookjapanDocument;

  if (!hasBookshelfShell(pageDoc)) {
    // Shell missing on an otherwise valid bookshelf URL: still loading, or
    // the tab left the authenticated bookshelf without changing the path.
    return { ok: true, state: "page_not_ready", pageUrl: canonical };
  }

  const tab = activeShelfTab(pageDoc);
  // Free-reading history is a separate tab and never purchased content.
  if (tab === "free_history") {
    const freeItems = buildItems(pageDoc, canonical, tab);
    if (freeItems.length === 0) {
      return {
        ok: true,
        state: isEmptyPurchasedShelf(pageDoc) ? "empty" : "ready",
        pageUrl: canonical,
        items: [],
        nextPageUrl: null,
      };
    }
    return {
      ok: true,
      state: "ready",
      pageUrl: canonical,
      items: freeItems,
      nextPageUrl: nextPageUrlOf(pageDoc, canonical),
    };
  }

  if (tab !== "purchased") {
    // Ambiguous / non-purchased active tab: do not promote anything.
    return { ok: true, state: "page_not_ready", pageUrl: canonical };
  }

  if (isEmptyPurchasedShelf(pageDoc)) {
    return {
      ok: true,
      state: "empty",
      pageUrl: canonical,
      items: [],
      nextPageUrl: null,
    };
  }

  const items = buildItems(pageDoc, canonical, tab);
  // No empty marker and no observed product-link item boundary → fail closed
  // rather than guess private selectors or hidden JSON.
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

export const ebookjapanLibraryPageReader: LibraryPageReader = {
  source: "ebookjapan",
  matchesLibraryUrl: isEbookjapanLibraryPageUrl,
  readPage: readEbookjapanLibraryPage,
};
