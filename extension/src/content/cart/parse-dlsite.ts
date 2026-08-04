import type { CartRow } from "./types.js";
import { parseDlsiteWorkno } from "./dlsite-workno.js";

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
    const title =
      host.querySelector(".work_name")?.textContent?.trim() ||
      host.querySelector(".work_name_inner")?.textContent?.trim() ||
      cid;
    const maker =
      host.querySelector(".maker_name")?.textContent?.trim() ||
      host.querySelector(".maker_name a")?.textContent?.trim() ||
      null;
    rows.push({ cid, title, maker, host });
  }
  return rows;
}

export { parseDlsiteWorkno, encodeDlsiteWorknoForUrl } from "./dlsite-workno.js";
