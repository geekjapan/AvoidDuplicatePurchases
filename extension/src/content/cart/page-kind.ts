import type { InterventionSource } from "@adp/shared";

/**
 * Cart page classification for T-CART (inverse of T-DISPLAY page-kind).
 * Exact documented cart pathnames only; trailing slash is the sole tolerance.
 * Child paths (checkout / ajax / API subpaths) are not cart pages.
 */
export function isCartInterventionPage(
  source: InterventionSource,
  pathname: string,
): boolean {
  switch (source) {
    case "dlsite":
      return pathname === "/maniax/cart" || pathname === "/maniax/cart/";
    case "fanza_doujin":
      return (
        pathname === "/dc/doujin/-/basket" || pathname === "/dc/doujin/-/basket/"
      );
    case "fanza_books":
      return pathname === "/basket" || pathname === "/basket/";
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
