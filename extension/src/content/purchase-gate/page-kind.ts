import type { InterventionSource } from "@adp/shared";

import { isCartInterventionPage } from "../cart/page-kind.js";

/**
 * Purchase-progression surfaces: after cart, before payment completion.
 *
 * Live store pathnames are only partially documented in prototypes (cart exact
 * paths are solid; checkout/order child paths vary). Classification is
 * deliberately broad for human-facing cart children and explicit order/payment
 * prefixes, while excluding ajax/API and thanks/complete pages.
 *
 * Remaining live-DOM assumptions are listed in the #57 PR description.
 */
export function isPurchaseProgressPage(
  source: InterventionSource,
  pathname: string,
): boolean {
  if (!pathname) return false;
  if (isCartInterventionPage(source, pathname)) return false;
  if (isNonHumanPath(pathname)) return false;
  if (isPostPaymentCompletePath(pathname)) return false;

  switch (source) {
    case "dlsite":
      return isDlsiteProgress(pathname);
    case "fanza_doujin":
      return isDoujinProgress(pathname);
    case "fanza_books":
      return isBooksProgress(pathname);
    default:
      return false;
  }
}

function isNonHumanPath(pathname: string): boolean {
  return /\/(?:ajax|api)(?:\/|$)/i.test(pathname);
}

function isPostPaymentCompletePath(pathname: string): boolean {
  return /(?:thanks|thankyou|complete|completed|finish|finished|done|success|完了)/i.test(
    pathname,
  );
}

function isPathOrChild(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isDlsiteProgress(pathname: string): boolean {
  // Cart child human pages (not exact cart, not ajax — already filtered).
  if (isPathOrChild(pathname, "/maniax/cart")) return true;
  if (isPathOrChild(pathname, "/maniax/order")) return true;
  if (isPathOrChild(pathname, "/maniax/payment")) return true;
  if (isPathOrChild(pathname, "/maniax/purchase")) return true;
  if (isPathOrChild(pathname, "/maniax/checkout")) return true;
  return false;
}

function isDoujinProgress(pathname: string): boolean {
  if (isPathOrChild(pathname, "/dc/doujin/-/basket")) return true;
  if (isPathOrChild(pathname, "/dc/doujin/-/order")) return true;
  if (isPathOrChild(pathname, "/dc/doujin/-/payment")) return true;
  if (isPathOrChild(pathname, "/dc/doujin/-/purchase")) return true;
  if (isPathOrChild(pathname, "/dc/doujin/-/checkout")) return true;
  return false;
}

function isBooksProgress(pathname: string): boolean {
  if (isPathOrChild(pathname, "/basket")) return true;
  if (isPathOrChild(pathname, "/order")) return true;
  if (isPathOrChild(pathname, "/payment")) return true;
  if (isPathOrChild(pathname, "/purchase")) return true;
  if (isPathOrChild(pathname, "/checkout")) return true;
  return false;
}
