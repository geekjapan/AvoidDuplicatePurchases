import { isCartInterventionPage } from "./page-kind.js";
import { fetchDoujinCartRows } from "./parse-doujin.js";
import { runCartPage } from "./runner.js";

/** Cart-page boot for FANZA Doujin; no-op outside basket. Called from fanza-doujin content entry. */
export function boot(pathname: string = window.location.pathname): void {
  if (!isCartInterventionPage("fanza_doujin", pathname)) return;
  void runCartPage("fanza_doujin", document, fetchDoujinCartRows);
}
