import { isCartInterventionPage } from "./page-kind.js";
import { fetchDoujinCartRows } from "./parse-doujin.js";
import { runCartPage } from "./runner.js";

export function boot(pathname: string = window.location.pathname): void {
  if (!isCartInterventionPage("fanza_doujin", pathname)) return;
  void runCartPage("fanza_doujin", document, fetchDoujinCartRows);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => boot(), { once: true });
} else {
  boot();
}
