import type { CartSource } from "@adp/shared";

/**
 * Exact cart-page pathname allowlist for remove/restore.
 * Only the documented actual cart path per store is allowed; trailing slash is
 * the sole tolerated difference. Child paths (checkout, ajax, API subpaths)
 * are out-of-cart. Query strings are outside pathname and therefore not
 * compared here (caller passes location.pathname).
 */
export function isCartPage(source: CartSource, pathname: string): boolean {
  switch (source) {
    case "dlsite":
      return pathname === "/maniax/cart" || pathname === "/maniax/cart/";
    case "fanza-doujin":
      return (
        pathname === "/dc/doujin/-/basket" || pathname === "/dc/doujin/-/basket/"
      );
    case "fanza-books":
      return pathname === "/basket" || pathname === "/basket/";
  }
}
