import type { InterventionSource } from "@adp/shared";
import type { ProductMeta } from "./types.js";
import { extractCidFromDocument } from "./cid.js";
import { queryFirst } from "./dom-utils.js";

function readJsonLdProduct(doc: Document): { name?: string; brand?: string } | null {
  const nodes = doc.getElementsByTagName("script");
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes.item(i);
    if (!node || node.getAttribute("type") !== "application/ld+json") continue;
    const text = node.textContent?.trim();
    if (!text) continue;
    try {
      const parsed = JSON.parse(text) as unknown;
      const objects = Array.isArray(parsed) ? parsed : [parsed];
      for (const obj of objects) {
        if (!obj || typeof obj !== "object") continue;
        const record = obj as Record<string, unknown>;
        if (record["@type"] !== "Product") continue;
        const name = typeof record.name === "string" ? record.name.trim() : undefined;
        let brand: string | undefined;
        const brandField = record.brand;
        if (typeof brandField === "string") {
          brand = brandField.trim();
        } else if (brandField && typeof brandField === "object") {
          const brandName = (brandField as Record<string, unknown>).name;
          if (typeof brandName === "string") brand = brandName.trim();
        }
        return { name, brand };
      }
    } catch {
      // ignore malformed JSON-LD blocks
    }
  }
  return null;
}

function readMetaContent(doc: Document, selector: string): string | null {
  const value = doc.querySelector<HTMLMetaElement>(selector)?.content?.trim();
  return value || null;
}

function readDlsiteMaker(doc: Document): string | null {
  const makerLink = queryFirst(doc, [
    ".maker_name a",
    "#work_maker a",
    "a[href*='/circle/profile/']",
  ]);
  if (makerLink?.textContent?.trim()) return makerLink.textContent.trim();
  const makerText = queryFirst(doc, [".maker_name", "#work_maker"])?.textContent?.trim();
  return makerText || null;
}

function readFanzaDoujinMaker(doc: Document): string | null {
  const jsonLd = readJsonLdProduct(doc);
  if (jsonLd?.brand) return jsonLd.brand;
  const maker = queryFirst(doc, [
    "[class*='maker']",
    "[class*='Maker']",
    ".m-productInformation__item a",
  ]);
  return maker?.textContent?.trim() || null;
}

function readFanzaBooksMaker(doc: Document): string | null {
  const jsonLd = readJsonLdProduct(doc);
  if (jsonLd?.brand) return jsonLd.brand;
  const maker = queryFirst(doc, [
    "[class*='author']",
    "[class*='maker']",
    "[itemprop='author']",
  ]);
  return maker?.textContent?.trim() || null;
}

function readTitle(doc: Document, source: InterventionSource): string | null {
  const jsonLd = readJsonLdProduct(doc);
  if (jsonLd?.name) return jsonLd.name;
  const ogTitle = readMetaContent(doc, 'meta[property="og:title"]');
  if (ogTitle) return ogTitle;
  if (source === "dlsite") {
    const workName = queryFirst(doc, ["#work_name", "h1.work_name"])?.textContent?.trim();
    if (workName) return workName;
  }
  const h1 = doc.querySelector("h1")?.textContent?.trim();
  return h1 || null;
}

function readMaker(doc: Document, source: InterventionSource): string | null {
  switch (source) {
    case "dlsite":
      return readDlsiteMaker(doc);
    case "fanza_doujin":
      return readFanzaDoujinMaker(doc);
    case "fanza_books":
      return readFanzaBooksMaker(doc);
    default:
      return null;
  }
}

export function extractProductMeta(
  source: InterventionSource,
  doc: Document,
): ProductMeta | null {
  const cid = extractCidFromDocument(source, doc);
  const title = readTitle(doc, source);
  if (!cid || !title) return null;
  return {
    source,
    cid,
    title,
    maker: readMaker(doc, source),
  };
}
