import { boot as bootCart } from "./cart/doujin-cart.js";
import { classifyDisplayPage } from "./page-kind.js";
import { runListingPage } from "./listing-page.js";
import { runProductPage } from "./product-page.js";

export function boot(pathname: string = window.location.pathname): void {
  const kind = classifyDisplayPage("fanza_doujin", pathname);
  if (kind === "product") {
    void runProductPage("fanza_doujin");
    return;
  }
  if (kind === "listing") {
    void runListingPage("fanza_doujin");
    return;
  }
  // basket: T-CART; library / history / unrecognized: no-op
  bootCart(pathname);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => boot(), { once: true });
} else {
  boot();
}
