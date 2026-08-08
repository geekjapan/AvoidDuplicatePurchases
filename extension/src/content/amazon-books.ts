import {
  MSG_AMAZON_READ_PAGE,
  type AmazonBooksItem,
  type AmazonBooksPageReply,
} from "../messages.js";

interface AmazonBooksElement {
  id: string;
  textContent: string | null;
  querySelector(selector: string): AmazonBooksElement | null;
  closest(selector: string): AmazonBooksElement | null;
}

interface AmazonBooksDocument {
  querySelectorAll(selector: string): ArrayLike<AmazonBooksElement>;
}

const AMAZON_BOOKS_PATH = "/hz/mycd/digital-console/contentlist/booksAll";
const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

export function isAmazonBooksPageUrl(pageUrl: string): boolean {
  try {
    const url = new URL(pageUrl);
    const pageNumber = url.searchParams.get("pageNumber");
    return (
      url.protocol === "https:" &&
      url.hostname === "www.amazon.co.jp" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      (url.pathname === AMAZON_BOOKS_PATH || url.pathname.startsWith(`${AMAZON_BOOKS_PATH}/`)) &&
      (pageNumber === null || /^[1-9]\d*$/.test(pageNumber))
    );
  } catch {
    return false;
  }
}

function pageNumberFromUrl(pageUrl: string): number | null {
  const value = new URL(pageUrl).searchParams.get("pageNumber");
  if (value === null) return null;
  const pageNumber = Number(value);
  return Number.isSafeInteger(pageNumber) ? pageNumber : null;
}

/** Read only the visible fields of the currently displayed Amazon Books page. */
export function parseAmazonBooksDocument(doc: AmazonBooksDocument): AmazonBooksItem[] {
  const seen = new Set<string>();
  return Array.from(doc.querySelectorAll('[id^="content-title-"]')).flatMap((titleEl) => {
    const asin = titleEl.id.slice("content-title-".length);
    if (!ASIN_PATTERN.test(asin) || seen.has(asin)) return [];

    const row = titleEl.closest("tr");
    if (!row) return [];

    const title = titleEl.textContent?.trim() ?? "";
    if (!title) return [];

    const author = row.querySelector(`#content-author-${asin}`)?.textContent?.trim() ?? "";
    const acquiredLabel =
      row.querySelector(`#content-acquired-date-${asin}`)?.textContent?.trim() ?? "";
    const isRental =
      acquiredLabel.startsWith("レンタル日:") ||
      row.querySelector(`#RETURN_CONTENT_ACTION_${asin}`) !== null;

    seen.add(asin);
    return [
      {
        asin,
        title,
        author,
        acquiredLabel,
        isRental,
        isRead: row.querySelector("#content-read-badge.readBadgeText") !== null,
      },
    ];
  });
}

export function readAmazonBooksPage(
  doc: AmazonBooksDocument,
  pageUrl: string,
): AmazonBooksPageReply {
  if (!isAmazonBooksPageUrl(pageUrl)) return { ok: false, error: "amazon_page_required" };
  return {
    ok: true,
    pageUrl,
    pageNumber: pageNumberFromUrl(pageUrl),
    items: parseAmazonBooksDocument(doc),
  };
}

if (typeof chrome !== "undefined" && typeof document !== "undefined") {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== MSG_AMAZON_READ_PAGE) return false;
    sendResponse(readAmazonBooksPage(document, location.href));
    return false;
  });
}
