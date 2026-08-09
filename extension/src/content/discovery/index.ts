import type { InterventionSource } from "@adp/shared";
import {
  MSG_DISCOVERY_READ_PRODUCT,
  MSG_DISCOVERY_READ_SEARCH,
  type DiscoveryReadProductMessage,
  type DiscoveryReadSearchMessage,
  type DiscoverySource,
  isDiscoverySource,
} from "../../messages.js";
import { classifyDisplayPage } from "../page-kind.js";
import { mountDiscoveryOriginUi } from "./origin-ui.js";
import { readDiscoveryProductPage } from "./product-reader.js";
import { readDiscoverySearchPage } from "./search-readers.js";

export { hideDiscoveryOriginUi, mountDiscoveryOriginUi } from "./origin-ui.js";
export { readDiscoverySearchPage } from "./search-readers.js";
export { readDiscoveryProductPage } from "./product-reader.js";
export { scoreDiscoveryCandidates } from "./identity.js";
export {
  buildDiscoverySearchUrl,
  counterpartSource,
  sanitizeSearchTitle,
  truncateCodePoints,
} from "./search-url.js";

/**
 * Register background → content discovery readers and optionally mount the
 * origin product CTA. Safe to call from dlsite / fanza-doujin boots.
 */
export function bootDiscovery(
  source: InterventionSource,
  pathname: string = typeof location !== "undefined" ? location.pathname : "",
  doc: Document = document,
): void {
  if (!isDiscoverySource(source)) return;

  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === MSG_DISCOVERY_READ_SEARCH) {
        const msg = message as DiscoveryReadSearchMessage;
        const target = msg.targetSource as DiscoverySource;
        if (!isDiscoverySource(target)) {
          sendResponse({ ok: false, error: "discovery_invalid_request" });
          return false;
        }
        sendResponse(
          readDiscoverySearchPage(
            target,
            doc,
            typeof location !== "undefined" ? location.href : "",
          ),
        );
        return false;
      }
      if (message?.type === MSG_DISCOVERY_READ_PRODUCT) {
        const msg = message as DiscoveryReadProductMessage;
        const target = msg.targetSource as DiscoverySource;
        if (!isDiscoverySource(target) || !msg.expectedCid) {
          sendResponse({ ok: false, error: "discovery_invalid_request" });
          return false;
        }
        sendResponse(
          readDiscoveryProductPage(
            target,
            msg.expectedCid,
            doc,
            typeof location !== "undefined" ? location.href : "",
          ),
        );
        return false;
      }
      return false;
    });
  }

  if (classifyDisplayPage(source, pathname) === "product") {
    mountDiscoveryOriginUi(source, doc);
  }
}
