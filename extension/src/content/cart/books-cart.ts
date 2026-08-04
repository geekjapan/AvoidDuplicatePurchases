import { isCartInterventionPage } from "./page-kind.js";
import { fetchBooksCartRows } from "./parse-books.js";
import { runCartPage } from "./runner.js";

export function boot(pathname: string = window.location.pathname): void {
  if (!isCartInterventionPage("fanza_books", pathname)) return;
  void runCartPage("fanza_books", document, fetchBooksCartRows);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => boot(), { once: true });
} else {
  boot();
}
