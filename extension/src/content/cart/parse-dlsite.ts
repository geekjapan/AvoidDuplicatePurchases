import type { CartRow } from "./types.js";

export function parseDlsiteCartRows(doc: Document): CartRow[] {
  const rows: CartRow[] = [];
  const items = doc.querySelectorAll<HTMLElement>("li");
  for (const host of Array.from(items)) {
    if (!host.className.split(/\s+/).includes("cart_list_item")) continue;
    const cid = host.getAttribute("data-workno")?.trim();
    if (!cid) continue;
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
