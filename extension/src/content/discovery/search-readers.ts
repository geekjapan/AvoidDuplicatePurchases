import { isValidDlsiteWorkno } from "@adp/shared/adapters/dlsite";
import type { DiscoveryCandidate, DiscoverySearchReply, DiscoverySource } from "../../messages.js";
import { extractCidFromUrl } from "../cid.js";
import { isVisible, visibleTextOf } from "../dom-visibility.js";
import { approvedStoreHttpsUrl } from "../banner.js";

export const DISCOVERY_SEARCH_CANDIDATE_CAP = 30;

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

function classListOf(el: Element): string[] {
  const raw = el.getAttribute("class") ?? (el as HTMLElement).className ?? "";
  return String(raw).split(/\s+/).filter(Boolean);
}

function hasClass(el: Element, name: string): boolean {
  return classListOf(el).includes(name);
}

function detectAgeGate(doc: Document, pageUrl: string): boolean {
  try {
    const path = new URL(pageUrl).pathname;
    if (/age_check/i.test(path)) return true;
  } catch {
    // ignore
  }
  const title = (doc.title ?? "").trim();
  if (/年齢認証|年齢確認/.test(title)) return true;
  const bodyText = doc.body ? visibleTextOf(doc.body).slice(0, 500) : "";
  if (/このページはアダルト/.test(bodyText) && /年齢認証/.test(bodyText)) return true;
  return false;
}

function detectLogin(doc: Document, pageUrl: string): boolean {
  try {
    const path = new URL(pageUrl).pathname;
    if (/\/login|\/my\/|=\/login\//i.test(path)) return true;
  } catch {
    // ignore
  }
  const title = (doc.title ?? "").trim();
  return /ログイン/.test(title) && /DMM|FANZA|DLsite/i.test(title);
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

function readDlsiteSearchCandidates(doc: Document, pageUrl: string): DiscoveryCandidate[] {
  // Portable selection (MockDocument + live DOM): class + data attribute filters.
  const items = findDescendants(doc, (el) => {
    if (el.tagName.toLowerCase() !== "li") return false;
    if (!hasClass(el, "search_result_img_box_inner")) return false;
    return Boolean(el.getAttribute("data-list_item_product_id")?.trim());
  });

  const out: DiscoveryCandidate[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (!isVisible(item)) continue;
    const rawId = item.getAttribute("data-list_item_product_id")?.trim().toUpperCase() ?? "";

    const productAnchor = findDescendant(item, (el) => {
      if (el.tagName.toLowerCase() !== "a") return false;
      const href = el.getAttribute("href") ?? (el as HTMLAnchorElement).href ?? "";
      return href.includes("/work/=/product_id/");
    }) as HTMLAnchorElement | null;
    if (!productAnchor) continue;

    const href = productAnchor.getAttribute("href") ?? productAnchor.href ?? "";
    const validated = validateProductUrl("dlsite", href, pageUrl);
    if (!validated) continue;

    let cid = validated.cid;
    if (rawId && isValidDlsiteWorkno(rawId) && rawId === validated.cid) {
      cid = rawId;
    }
    if (seen.has(cid)) continue;

    const titleAnchor =
      (findDescendant(item, (el) => {
        if (el.tagName.toLowerCase() !== "a") return false;
        const parent = el.parentElement;
        return Boolean(parent && parent.tagName.toLowerCase() === "dd" && hasClass(parent, "work_name"));
      }) as HTMLAnchorElement | null) ?? productAnchor;

    const titleAttr = titleAnchor.getAttribute("title")?.trim();
    const titleText = visibleTextOf(titleAnchor).trim();
    const title = (titleAttr || titleText).trim();
    if (!title) continue;

    const makerEl =
      findDescendant(item, (el) => {
        if (el.tagName.toLowerCase() === "a") {
          const parent = el.parentElement;
          return Boolean(parent && parent.tagName.toLowerCase() === "dd" && hasClass(parent, "maker_name"));
        }
        return el.tagName.toLowerCase() === "dd" && hasClass(el, "maker_name");
      }) ?? null;
    const makerText = makerEl ? visibleTextOf(makerEl).trim() : "";
    const maker = makerText || null;

    seen.add(cid);
    out.push({
      targetSource: "dlsite",
      cid,
      title,
      maker,
      productUrl: validated.productUrl,
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
    const makerText = makerEl ? visibleTextOf(makerEl).trim() : "";
    const maker = makerText || null;

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
        ? findDescendants(doc, (el) => {
            return (
              hasClass(el, "n_worklist") ||
              hasClass(el, "search_result") ||
              hasClass(el, "search_result_img_box_inner")
            );
          }).length > 0
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
