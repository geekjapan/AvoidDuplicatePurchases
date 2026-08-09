import { boot as bootCart } from "./cart/books-cart.js";
import { isCartInterventionPage } from "./cart/page-kind.js";
import { fetchBooksCartCids } from "./cart/parse-books.js";
import { classifyDisplayPage } from "./page-kind.js";
import { isPurchaseProgressPage, runPurchaseProgressPage } from "./purchase-gate/index.js";
import { runListingPage } from "./listing-page.js";
import { runProductPage } from "./product-page.js";

export function boot(pathname: string = window.location.pathname): void {
  const kind = classifyDisplayPage("fanza_books", pathname);
  if (kind === "product") {
    void runProductPage("fanza_books");
    return;
  }
  if (kind === "listing") {
    void runListingPage("fanza_books");
    return;
  }
  if (isCartInterventionPage("fanza_books", pathname)) {
    bootCart(pathname);
    return;
  }
  if (isPurchaseProgressPage("fanza_books", pathname)) {
    void runPurchaseProgressPage("fanza_books", document, {
      loadCartCids: () => fetchBooksCartCids(),
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
