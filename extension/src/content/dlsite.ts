import { runListingPage } from "./listing-page.js";
import { runProductPage } from "./product-page.js";

function isProductPage(pathname: string): boolean {
  return /\/work\/=\/product_id\//i.test(pathname);
}

function boot(): void {
  const { pathname } = window.location;
  if (isProductPage(pathname)) {
    void runProductPage("dlsite");
    return;
  }
  void runListingPage("dlsite");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
