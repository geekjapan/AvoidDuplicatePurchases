import type { InterventionSource } from "@adp/shared";

/** Product / verified listing / no T-DISPLAY intervention. */
export type DisplayPageKind = "product" | "listing" | "none";

/**
 * Classify a content-script page for T-DISPLAY.
 * Product and verified listing only; cart/basket/library/history/unrecognized → none.
 * Cart intervention belongs to T-CART.
 */
export function classifyDisplayPage(
  source: InterventionSource,
  pathname: string,
): DisplayPageKind {
  switch (source) {
    case "dlsite":
      return classifyDlsite(pathname);
    case "fanza_doujin":
      return classifyFanzaDoujin(pathname);
    case "fanza_books":
      return classifyFanzaBooks(pathname);
    default:
      return "none";
  }
}

function classifyDlsite(pathname: string): DisplayPageKind {
  if (/\/work\/=\/product_id\//i.test(pathname)) return "product";
  // Verified listing shapes used by fixtures / representative search UIs.
  if (/\/=\/keyword\//i.test(pathname)) return "listing";
  if (/\/fsr\//i.test(pathname)) return "listing";
  return "none";
}

function classifyFanzaDoujin(pathname: string): DisplayPageKind {
  if (/\/dc\/doujin\/-\/detail\//i.test(pathname)) return "product";
  if (/\/dc\/doujin\/-\/list\//i.test(pathname)) return "listing";
  return "none";
}

function classifyFanzaBooks(pathname: string): DisplayPageKind {
  if (/^\/product\/\d+\/[^/]+\/?$/i.test(pathname)) return "product";
  if (/^\/list(?:\/|$)/i.test(pathname)) return "listing";
  return "none";
}
