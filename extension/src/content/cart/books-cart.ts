import { isCartInterventionPage } from "./page-kind.js";
import { fetchBooksCartCids, fetchBooksCartRows } from "./parse-books.js";
import { runCartPage } from "./runner.js";

/** Cart-page boot for FANZA Books; no-op outside basket. Called from fanza-books content entry. */
export function boot(pathname: string = window.location.pathname): void {
  if (!isCartInterventionPage("fanza_books", pathname)) return;
  void runCartPage("fanza_books", document, fetchBooksCartRows, undefined, {
    loadCartCids: () => fetchBooksCartCids(),
  });
}
