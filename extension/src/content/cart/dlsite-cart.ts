import { isCartInterventionPage } from "./page-kind.js";
import { parseDlsiteCartRows } from "./parse-dlsite.js";
import { runCartPage } from "./runner.js";

/** Cart-page boot for DLsite; no-op outside cart. Called from dlsite content entry. */
export function boot(pathname: string = window.location.pathname): void {
  if (!isCartInterventionPage("dlsite", pathname)) return;
  void runCartPage("dlsite", document, parseDlsiteCartRows);
}
