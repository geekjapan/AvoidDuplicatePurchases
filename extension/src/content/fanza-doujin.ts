import { boot as bootCart } from "./cart/doujin-cart.js";
import { isCartInterventionPage } from "./cart/page-kind.js";
import { fetchDoujinCartCids } from "./cart/parse-doujin.js";
import { classifyDisplayPage } from "./page-kind.js";
import { isPurchaseProgressPage, runPurchaseProgressPage } from "./purchase-gate/index.js";
import { runListingPage } from "./listing-page.js";
import { runProductPage } from "./product-page.js";
import { bootDiscovery } from "./discovery/index.js";

/**
 * Route cart / purchase-progress / product / listing surfaces.
 * Separated from discovery so SPA history re-entry does not re-register
 * chrome.runtime.onMessage listeners (#57 transition-state fix).
 */
export function runSurface(pathname: string = window.location.pathname): void {
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
    // Cause probe: progress gate must re-run after basket→order SPA/path change.
    void runPurchaseProgressPage("fanza_doujin", document, {
      loadCartCids: () => fetchDoujinCartCids(),
    });
    return;
  }
  // library / history / unrecognized: no-op
}

export function boot(pathname: string = window.location.pathname): void {
  // Discovery message handlers + product CTA (independent of ownership lookup).
  bootDiscovery("fanza_doujin", pathname);
  runSurface(pathname);
}

let spaHookInstalled = false;
let lastSurfacePath: string | null = null;

/**
 * FANZA Doujin basket is a React SPA (prototype/cart-delete). Client-side
 * history changes do not re-inject the content script, so cart gate can mount
 * on basket then vanish on order/confirm without a full reload. Re-route only
 * the surface when pathname changes; do not re-boot discovery.
 */
function installSpaSurfaceRerun(): void {
  if (spaHookInstalled) return;
  spaHookInstalled = true;
  lastSurfacePath =
    typeof window !== "undefined" ? window.location.pathname : null;

  const onPathMaybeChanged = (): void => {
    if (typeof window === "undefined") return;
    const next = window.location.pathname;
    if (next === lastSurfacePath) return;
    lastSurfacePath = next;
    runSurface(next);
  };

  window.addEventListener("popstate", onPathMaybeChanged);
  const wrap = (method: "pushState" | "replaceState"): void => {
    const original = history[method].bind(history);
    history[method] = ((...args: Parameters<History["pushState"]>) => {
      const ret = original(...args);
      queueMicrotask(onPathMaybeChanged);
      return ret;
    }) as History["pushState"];
  };
  wrap("pushState");
  wrap("replaceState");
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      boot();
      installSpaSurfaceRerun();
    },
    { once: true },
  );
} else {
  boot();
  installSpaSurfaceRerun();
}
