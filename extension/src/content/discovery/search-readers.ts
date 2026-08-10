import { isValidDlsiteWorkno } from "@adp/shared/adapters/dlsite";
import type { DiscoveryCandidate, DiscoverySearchReply, DiscoverySource } from "../../messages.js";
import { extractCidFromUrl } from "../cid.js";
import { isVisible, visibleTextOf } from "../dom-visibility.js";
import { approvedStoreHttpsUrl } from "../banner.js";
import { detectAgeGate, detectLogin, safePageUrl } from "./page-guards.js";

export const DISCOVERY_SEARCH_CANDIDATE_CAP = 30;

/** Wave-1 DLsite discovery product URLs are maniax floor only (content_scripts range). */
const DLSITE_MANIAX_PRODUCT_PATH =
  /^\/maniax\/work\/=\/product_id\/[A-Za-z0-9]+\.html$/i;

function classListOf(el: Element): string[] {
  const raw = el.getAttribute("class") ?? (el as HTMLElement).className ?? "";
  return String(raw).split(/\s+/).filter(Boolean);
}

function hasClass(el: Element, name: string): boolean {
  return classListOf(el).includes(name);
}

function absoluteHref(href: string, pageUrl: string): string | null {
  try {
    return new URL(href, pageUrl).href;
  } catch {
    return null;
  }
}

function validateProductUrl(
  targetSource: DiscoverySource,
  href: string,
  pageUrl: string,
): { productUrl: string; cid: string } | null {
  const abs = absoluteHref(href, pageUrl);
  if (!abs) return null;
  let cleaned = abs;
  try {
    const u = new URL(abs);
    if (targetSource === "fanza_doujin") {
      u.search = "";
      u.hash = "";
      cleaned = u.href;
    }
  } catch {
    return null;
  }
  const cid = extractCidFromUrl(targetSource, cleaned);
  if (!cid) return null;
  if (targetSource === "dlsite") {
    try {
      const path = new URL(cleaned).pathname;
      if (!DLSITE_MANIAX_PRODUCT_PATH.test(path)) return null;
    } catch {
      return null;
    }
  }
  const approved = approvedStoreHttpsUrl(cleaned, targetSource);
  if (!approved) return null;
  return { productUrl: approved, cid };
}

function allElements(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll("*"));
}

function findDescendant(
  root: Element,
  predicate: (el: Element) => boolean,
): Element | null {
  for (const el of allElements(root)) {
    if (predicate(el)) return el;
  }
  return null;
}

function findDescendants(
  root: ParentNode,
  predicate: (el: Element) => boolean,
): Element[] {
  return allElements(root).filter(predicate);
}

/** True when el is a plausible single search-result card root (not page chrome). */
function isDlsiteResultCardRoot(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "li" || tag === "article") return true;
  // Live list view (show_type=1/2): table.work_1col_table > tr[data-list_item_product_id].
  if (tag === "tr" && Boolean(el.getAttribute("data-list_item_product_id")?.trim())) {
    return true;
  }
  if ((el.getAttribute("role") ?? "").toLowerCase() === "listitem") return true;
  // Legacy DLsite list card class (with or without data-list_item_product_id).
  if (hasClass(el, "search_result_img_box_inner") || hasClass(el, "search_result_img_box")) {
    return true;
  }
  return false;
}

/** Regions that host page chrome (nav/recommend/footer lists), not search results. */
function isPageChromeRegion(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  return tag === "header" || tag === "nav" || tag === "footer" || tag === "aside";
}

/**
 * Stop climbing at document / layout shells so whole-page containers never
 * become a "card". Chrome regions also stop the climb (and reject the link).
 */
function isCardClimbBoundary(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  return (
    tag === "html" ||
    tag === "body" ||
    tag === "head" ||
    tag === "main" ||
    isPageChromeRegion(el)
  );
}

function hasPageChromeRegionAncestor(el: Element): boolean {
  let parent: Element | null = el.parentElement;
  while (parent) {
    if (isPageChromeRegion(parent)) return true;
    parent = parent.parentElement;
  }
  return false;
}

/** Known legacy search-list shell classes (empty-results signal when present). */
function isDlsiteLegacySearchShell(el: Element): boolean {
  return (
    hasClass(el, "n_worklist") ||
    hasClass(el, "search_result") ||
    hasClass(el, "search_result_img_box_inner") ||
    hasClass(el, "search_result_img_box") ||
    // Live list view shell (show_type=1/2).
    hasClass(el, "work_1col_table") ||
    hasClass(el, "work_1col")
  );
}

function anchorHref(el: Element): string {
  return el.getAttribute("href") ?? (el as HTMLAnchorElement).href ?? "";
}

function collectValidatedProductInCard(
  card: Element,
  pageUrl: string,
): { productUrl: string; cid: string; anchors: Element[] } | null {
  const anchors = findDescendants(card, (el) => el.tagName.toLowerCase() === "a");
  const byCid = new Map<string, { productUrl: string; anchors: Element[] }>();

  for (const a of anchors) {
    const href = anchorHref(a);
    if (!href.includes("/work/=/product_id/")) continue;
    const validated = validateProductUrl("dlsite", href, pageUrl);
    if (!validated) continue;
    const existing = byCid.get(validated.cid);
    if (existing) {
      existing.anchors.push(a);
    } else {
      byCid.set(validated.cid, { productUrl: validated.productUrl, anchors: [a] });
    }
  }

  // Ambiguous multi-product card → fail closed.
  if (byCid.size !== 1) return null;
  const [cid, data] = [...byCid.entries()][0]!;
  return { cid, productUrl: data.productUrl, anchors: data.anchors };
}

/**
 * Climb from a product anchor to the nearest result-card root.
 * Page-wide links under nav/header/footer/aside (including listitem chrome)
 * and bare document shells without a card root are rejected.
 */
function resolveDlsiteResultCard(anchor: Element): Element | null {
  let current: Element | null = anchor;
  while (current) {
    if (isPageChromeRegion(current)) return null;
    if (isDlsiteResultCardRoot(current)) {
      // li/article under chrome lists are not result cards.
      if (hasPageChromeRegionAncestor(current)) return null;
      return current;
    }
    const parent: Element | null = current.parentElement;
    if (!parent || isCardClimbBoundary(parent)) return null;
    current = parent;
  }
  return null;
}

function isWorkNameContainer(el: Element): boolean {
  if (!hasClass(el, "work_name")) return false;
  const tag = el.tagName.toLowerCase();
  // Package view: dd.work_name; list view (work_1col): dt.work_name.
  return tag === "dd" || tag === "dt" || tag === "div";
}

function readDlsiteTitleFromCard(
  card: Element,
  productAnchors: Element[],
): string | null {
  const workNameAnchor = findDescendant(card, (el) => {
    if (el.tagName.toLowerCase() !== "a") return false;
    // Live package cards wrap the title anchor in div.multiline_truncate under
    // dd.work_name; list view uses dt.work_name > a. Climb past thin wrappers.
    let parent: Element | null = el.parentElement;
    let depth = 0;
    while (parent && parent !== card && depth < 4) {
      if (isWorkNameContainer(parent)) return true;
      parent = parent.parentElement;
      depth += 1;
    }
    return false;
  });
  if (workNameAnchor) {
    const titleAttr = workNameAnchor.getAttribute("title")?.trim() ?? "";
    const titleText = visibleTextOf(workNameAnchor).trim();
    const title = (titleAttr || titleText).trim();
    if (title) return title;
  }

  // Prefer product anchors that expose visible title text (skip thumb-only links).
  for (const a of productAnchors) {
    if (!isVisible(a)) continue;
    const titleAttr = a.getAttribute("title")?.trim() ?? "";
    const titleText = visibleTextOf(a).trim();
    const title = (titleAttr || titleText).trim();
    if (title) return title;
  }

  // Fall back to img alt on a product anchor inside the card.
  for (const a of productAnchors) {
    const img = findDescendant(a, (el) => el.tagName.toLowerCase() === "img");
    const alt = img?.getAttribute("alt")?.trim() ?? "";
    if (alt) return alt;
  }
  return null;
}

function readDlsiteMakerFromCard(card: Element): string | null {
  const makerEl =
    findDescendant(card, (el) => {
      if (el.tagName.toLowerCase() === "a") {
        const parent = el.parentElement;
        return Boolean(
          parent &&
            (parent.tagName.toLowerCase() === "dd" || parent.tagName.toLowerCase() === "dt") &&
            hasClass(parent, "maker_name"),
        );
      }
      return (
        (el.tagName.toLowerCase() === "dd" || el.tagName.toLowerCase() === "dt") &&
        hasClass(el, "maker_name")
      );
    }) ?? null;
  if (makerEl) {
    // Prefer the first circle/maker profile link text (ignore trailing noise).
    if (makerEl.tagName.toLowerCase() === "a") {
      const text = visibleTextOf(makerEl).trim();
      if (text) return text;
    } else {
      const makerLink = findDescendant(makerEl, (el) => {
        if (el.tagName.toLowerCase() !== "a") return false;
        if (!isVisible(el)) return false;
        const href = anchorHref(el);
        return /\/circle\//i.test(href) || /maker_id/i.test(href);
      });
      if (makerLink) {
        const text = visibleTextOf(makerLink).trim();
        if (text) return text;
      }
      const text = visibleTextOf(makerEl).trim();
      if (text) return text;
    }
  }

  // Modern markup: circle / maker profile links inside the card.
  const circleAnchor = findDescendant(card, (el) => {
    if (el.tagName.toLowerCase() !== "a") return false;
    if (!isVisible(el)) return false;
    const href = anchorHref(el);
    return /\/circle\//i.test(href) || /maker_id/i.test(href);
  });
  if (circleAnchor) {
    const text = visibleTextOf(circleAnchor).trim();
    if (text) return text;
  }
  return null;
}

function collectDlsiteResultCards(doc: Document): Element[] {
  // Legacy package view: li.search_result_img_box_inner + data-list_item_product_id.
  // Live list view (show_type=1/2): tr[data-list_item_product_id] (class often empty).
  const legacy = findDescendants(doc, (el) => {
    const tag = el.tagName.toLowerCase();
    const rawId = el.getAttribute("data-list_item_product_id")?.trim();
    if (!rawId) return false;
    if (tag === "tr") return true;
    if (tag !== "li") return false;
    return (
      hasClass(el, "search_result_img_box_inner") || hasClass(el, "search_result_img_box")
    );
  });
  if (legacy.length > 0) return legacy;

  // Modern / attribute-diff: cards that own a validated maniax product link.
  // Discover via product anchors so we never treat bare page-wide links as cards.
  const productAnchors = findDescendants(doc, (el) => {
    if (el.tagName.toLowerCase() !== "a") return false;
    const href = anchorHref(el);
    return href.includes("/maniax/work/=/product_id/") || href.includes("/work/=/product_id/");
  });

  const cards: Element[] = [];
  const seen = new Set<Element>();
  for (const anchor of productAnchors) {
    const card = resolveDlsiteResultCard(anchor);
    if (!card || seen.has(card)) continue;
    seen.add(card);
    cards.push(card);
  }
  return cards;
}

function readDlsiteSearchCandidates(doc: Document, pageUrl: string): DiscoveryCandidate[] {
  const items = collectDlsiteResultCards(doc);
  const out: DiscoveryCandidate[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (!isVisible(item)) continue;

    const product = collectValidatedProductInCard(item, pageUrl);
    if (!product) continue;

    let cid = product.cid;
    const rawId = item.getAttribute("data-list_item_product_id")?.trim().toUpperCase() ?? "";
    if (rawId && isValidDlsiteWorkno(rawId) && rawId === product.cid) {
      cid = rawId;
    }
    if (seen.has(cid)) continue;

    // Title/maker only from visible card text; missing either → fail closed.
    const title = readDlsiteTitleFromCard(item, product.anchors);
    if (!title) continue;
    const maker = readDlsiteMakerFromCard(item);
    if (!maker) continue;

    seen.add(cid);
    out.push({
      targetSource: "dlsite",
      cid,
      title,
      maker,
      productUrl: product.productUrl,
      rank: out.length + 1,
    });
    if (out.length >= DISCOVERY_SEARCH_CANDIDATE_CAP) break;
  }
  return out;
}

function readFanzaDoujinSearchCandidates(
  doc: Document,
  pageUrl: string,
): DiscoveryCandidate[] {
  // Prefer items under productList containers; fall back to class-only items.
  const listRoots = findDescendants(doc, (el) => {
    if (el.tagName.toLowerCase() !== "ul") return false;
    return hasClass(el, "productList") && hasClass(el, "fn-productList");
  });
  const itemPool: Element[] =
    listRoots.length > 0
      ? listRoots.flatMap((root) =>
          findDescendants(root, (el) => {
            return el.tagName.toLowerCase() === "li" && hasClass(el, "productList__item");
          }),
        )
      : findDescendants(doc, (el) => {
          return el.tagName.toLowerCase() === "li" && hasClass(el, "productList__item");
        });

  const out: DiscoveryCandidate[] = [];
  const seen = new Set<string>();

  for (const item of itemPool) {
    if (!isVisible(item)) continue;

    const productAnchor = findDescendant(item, (el) => {
      if (el.tagName.toLowerCase() !== "a") return false;
      const href = el.getAttribute("href") ?? (el as HTMLAnchorElement).href ?? "";
      return href.includes("/dc/doujin/-/detail/=/cid=");
    }) as HTMLAnchorElement | null;
    if (!productAnchor) continue;

    const href = productAnchor.getAttribute("href") ?? productAnchor.href ?? "";
    const validated = validateProductUrl("fanza_doujin", href, pageUrl);
    if (!validated) continue;
    if (seen.has(validated.cid)) continue;

    const titleEl =
      findDescendant(item, (el) => hasClass(el, "tileListTtl__txt")) ?? null;
    let title = titleEl ? visibleTextOf(titleEl).trim() : "";
    if (!title) {
      const img = findDescendant(item, (el) => el.tagName.toLowerCase() === "img");
      title = img?.getAttribute("alt")?.trim() ?? "";
    }
    if (!title) continue;

    const makerEl =
      findDescendant(item, (el) => hasClass(el, "tileListTtl__txt--author")) ?? null;
    // Live cards often list circle + creators ("ろまあぽ / 声優A 他"). Prefer the
    // first article=maker link so makerMatchKey aligns with DLsite circle-only
    // product meta; fall back to full visible author text only when needed.
    let maker: string | null = null;
    if (makerEl) {
      const makerLink = findDescendant(makerEl, (el) => {
        if (el.tagName.toLowerCase() !== "a") return false;
        if (!isVisible(el)) return false;
        return /article=maker/i.test(anchorHref(el));
      });
      const makerText = makerLink
        ? visibleTextOf(makerLink).trim()
        : visibleTextOf(makerEl).trim();
      maker = makerText || null;
    }

    seen.add(validated.cid);
    out.push({
      targetSource: "fanza_doujin",
      cid: validated.cid,
      title,
      maker,
      productUrl: validated.productUrl,
      rank: out.length + 1,
    });
    if (out.length >= DISCOVERY_SEARCH_CANDIDATE_CAP) break;
  }
  return out;
}

/**
 * Read visible search-result candidates only. Prices on list cards are ignored
 * (never mixed into three-tier observation).
 */
export function readDiscoverySearchPage(
  targetSource: DiscoverySource,
  doc: Document,
  pageUrl: string,
): DiscoverySearchReply {
  const safe = safePageUrl(pageUrl) || pageUrl;

  if (detectAgeGate(doc, pageUrl)) {
    return { ok: true, state: "age_gate", pageUrl: safe };
  }
  if (detectLogin(doc, pageUrl)) {
    return { ok: true, state: "login", pageUrl: safe };
  }

  let pathOk = false;
  try {
    const path = new URL(pageUrl).pathname;
    if (targetSource === "dlsite") {
      pathOk = /\/fsr\//i.test(path) || /\/=\/keyword\//i.test(path);
    } else {
      pathOk = /\/dc\/doujin\/-\/list\//i.test(path);
    }
  } catch {
    pathOk = false;
  }
  if (!pathOk) {
    return { ok: true, state: "page_not_ready", pageUrl: safe };
  }

  const candidates =
    targetSource === "dlsite"
      ? readDlsiteSearchCandidates(doc, pageUrl)
      : readFanzaDoujinSearchCandidates(doc, pageUrl);

  if (candidates.length === 0) {
    const hasContainer =
      targetSource === "dlsite"
        ? // Never treat bare li/article as shell evidence (chrome pages always have them).
          // Require legacy list classes and/or a card that owns a validated maniax product.
          findDescendants(doc, isDlsiteLegacySearchShell).length > 0 ||
          collectDlsiteResultCards(doc).some(
            (card) => collectValidatedProductInCard(card, pageUrl) !== null,
          )
        : findDescendants(doc, (el) => {
            return hasClass(el, "productList") || hasClass(el, "productList__item");
          }).length > 0;
    if (!hasContainer) {
      return { ok: true, state: "page_not_ready", pageUrl: safe };
    }
    return { ok: true, state: "empty", pageUrl: safe, candidates: [] };
  }

  return { ok: true, state: "ready", pageUrl: safe, candidates };
}
