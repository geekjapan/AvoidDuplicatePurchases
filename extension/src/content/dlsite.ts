import { boot as bootCart } from "./cart/dlsite-cart.js";
import { isCartInterventionPage } from "./cart/page-kind.js";
import { classifyDisplayPage } from "./page-kind.js";
import { isPurchaseProgressPage, runPurchaseProgressPage } from "./purchase-gate/index.js";
import { runListingPage } from "./listing-page.js";
import { runProductPage } from "./product-page.js";
import { bootDiscovery } from "./discovery/index.js";

export function boot(pathname: string = window.location.pathname): void {
  // Discovery message handlers + product CTA (independent of ownership lookup).
  bootDiscovery("dlsite", pathname);

  const kind = classifyDisplayPage("dlsite", pathname);
  if (kind === "product") {
    void runProductPage("dlsite");
    return;
  }
  if (kind === "listing") {
    void runListingPage("dlsite");
    return;
  }
  if (isCartInterventionPage("dlsite", pathname)) {
    bootCart(pathname);
    return;
  }
  // Purchase-progression (after cart, before payment complete): fail-closed gate.
  if (isPurchaseProgressPage("dlsite", pathname)) {
    void runPurchaseProgressPage("dlsite", document);
    return;
  }
  // library / history / unrecognized: no-op
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => boot(), { once: true });
} else {
  boot();
}
