import type { CartSource } from "@adp/shared";

/** Cart pages where remove/restore may run (page-context values are valid). */
export function isCartPage(source: CartSource, pathname: string): boolean {
  switch (source) {
    case "dlsite":
      return /^\/maniax\/cart(?:\/|$)/i.test(pathname);
    case "fanza-doujin":
      return /^\/dc\/doujin\/-\/basket(?:\/|$)/i.test(pathname);
    case "fanza-books":
      return /^\/basket(?:\/|$)/i.test(pathname);
  }
}
