import { boot as bootCart } from "./cart/doujin-cart.js";
import { isCartInterventionPage } from "./cart/page-kind.js";
import { fetchDoujinCartCids } from "./cart/parse-doujin.js";
import { classifyDisplayPage } from "./page-kind.js";
import { isPurchaseProgressPage, runPurchaseProgressPage } from "./purchase-gate/index.js";
import { runListingPage } from "./listing-page.js";
import { runProductPage } from "./product-page.js";
import { bootDiscovery } from "./discovery/index.js";

export function boot(pathname: string = window.location.pathname): void {
  // Discovery message handlers + product CTA (independent of ownership lookup).
  bootDiscovery("fanza_doujin", pathname);

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
