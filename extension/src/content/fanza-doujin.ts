import { runListingPage } from "./listing-page.js";
import { runProductPage } from "./product-page.js";

function isProductPage(pathname: string): boolean {
  return /\/dc\/doujin\/-\/detail\//i.test(pathname);
}

function boot(): void {
  const { pathname } = window.location;
  if (isProductPage(pathname)) {
    void runProductPage("fanza_doujin");
    return;
  }
  void runListingPage("fanza_doujin");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
