import { boot as bootCart } from "./cart/doujin-cart.js";
import { isCartInterventionPage } from "./cart/page-kind.js";
import { fetchDoujinCartCids } from "./cart/parse-doujin.js";
import { classifyDisplayPage } from "./page-kind.js";
import { isPurchaseProgressPage, runPurchaseProgressPage } from "./purchase-gate/index.js";
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
  if (isCartInterventionPage("fanza_doujin", pathname)) {
    bootCart(pathname);
    return;
  }
  if (isPurchaseProgressPage("fanza_doujin", pathname)) {
    void runPurchaseProgressPage("fanza_doujin", document, {
      loadCartCids: () => fetchDoujinCartCids(),
    });
    return;
  }
  // library / history / unrecognized: no-op
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => boot(), { once: true });
} else {
  boot();
}
