import type { InterventionSource } from "@adp/shared";

/** Cart page classification for T-CART (inverse of T-DISPLAY page-kind). */
export function isCartInterventionPage(
  source: InterventionSource,
  pathname: string,
): boolean {
  switch (source) {
    case "dlsite":
      return /^\/maniax\/cart(?:\/|$)/i.test(pathname);
    case "fanza_doujin":
      return /^\/dc\/doujin\/-\/basket(?:\/|$)/i.test(pathname);
    case "fanza_books":
      return /^\/basket(?:\/|$)/i.test(pathname);
    default:
      return false;
  }
}

export function interventionToCartSource(
  source: InterventionSource,
): "dlsite" | "fanza-doujin" | "fanza-books" {
  switch (source) {
    case "dlsite":
      return "dlsite";
    case "fanza_doujin":
      return "fanza-doujin";
    case "fanza_books":
      return "fanza-books";
  }
}
