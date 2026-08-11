import type { CartRow } from "./types.js";
import { parseDlsiteWorkno } from "./dlsite-workno.js";
import { readCartFinalPrice } from "./final-price.js";

function directClassToken(el: Element, token: string): boolean {
  return (el.getAttribute("class") ?? "").split(/\s+/).includes(token);
}

function readElementLabel(el: Element): string {
  const title = el.getAttribute("title")?.trim();
  if (title) return title;
  return el.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function readDlsiteCartTitle(host: HTMLElement, cid: string): string {
  const containers: Element[] = [];
  if (directClassToken(host, "work_name")) containers.push(host);
  for (const selector of [".work_name", ".work_name_inner"]) {
    const container = host.querySelector(selector);
    if (container && !containers.includes(container)) containers.push(container);
  }

  // The linked label is the same stable title source used by the search
  // reader. It avoids including cart-only badges or contributor labels.
  for (const container of containers) {
    const link = container.querySelector("a");
    const label = link ? readElementLabel(link) : readElementLabel(container);
    if (label) return label;
  }

  // Some cart renderers omit work_name but keep the canonical product link.
  for (const anchor of Array.from(host.querySelectorAll("a"))) {
    const href = anchor.getAttribute("href") ?? (anchor as HTMLAnchorElement).href ?? "";
    if (!href.includes(`/product_id/${cid}`)) continue;
    const label = readElementLabel(anchor);
    if (label) return label;
    const image = anchor.querySelector("img");
    const alt = image?.getAttribute("alt")?.trim();
    if (alt) return alt;
  }

  for (const attribute of ["data-title", "data-work-name", "aria-label"]) {
    const value = host.getAttribute(attribute)?.trim();
    if (value) return value;
  }
  return cid;
}

function readDlsiteCartMaker(host: HTMLElement): string | null {
  // A maker cell can also contain voice actors / contributors. Prefer its
  // profile link so the identity gate receives the same maker token as the
  // product-page reader.
  const makerLink = host.querySelector(".maker_name a");
  const linked = makerLink ? readElementLabel(makerLink) : "";
  if (linked) return linked;

  const maker =
    (directClassToken(host, "maker_name") ? host : host.querySelector(".maker_name")) ??
    host.querySelector("[data-maker-name]");
  const text = maker?.textContent?.replace(/\s+/g, " ").trim() ?? "";
  return text || null;
}

/**
 * Parse DLsite cart rows from DOM.
 * - Validates workno before row creation (see dlsite-workno.ts).
 * - Dedupes same normalized workno (layout clones; prototype/dlsite README)
 *   while preserving the first exact actionable row host.
 */
export function parseDlsiteCartRows(doc: Document): CartRow[] {
  const rows: CartRow[] = [];
  const seen = new Set<string>();
  const items = doc.querySelectorAll<HTMLElement>("li");
  for (const host of Array.from(items)) {
    if (!host.className.split(/\s+/).includes("cart_list_item")) continue;
    const raw = host.getAttribute("data-workno");
    const cid = parseDlsiteWorkno(raw);
    if (!cid) continue;
    // Layout may emit the same workno twice; one lookup/warning/delete only.
    if (seen.has(cid)) continue;
    seen.add(cid);
    const title = readDlsiteCartTitle(host, cid);
    const maker = readDlsiteCartMaker(host);
    const finalPrice = readCartFinalPrice("dlsite", host);
    rows.push({
      cid,
      title,
      maker,
      host,
      ...(finalPrice ? { finalPrice } : {}),
    });
  }
  return rows;
}

export { parseDlsiteWorkno, encodeDlsiteWorknoForUrl } from "./dlsite-workno.js";
