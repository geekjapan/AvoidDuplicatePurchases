import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAmazonBooksPageUrl,
  parseAmazonBooksDocument,
  readAmazonBooksPage,
} from "../amazon-books.js";
import { MockDocument } from "./mock-document.js";

const PAGE_URL =
  "https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll/dateDsc?pageNumber=1";

function appendField(
  doc: MockDocument,
  parent: ReturnType<MockDocument["createElement"]>,
  tag: string,
  id: string,
  text: string,
): void {
  const field = doc.createElement(tag);
  field.id = id;
  field.textContent = text;
  parent.appendChild(field);
}

function appendRow(
  doc: MockDocument,
  asin: string,
  title: string,
  date: string,
  rental = false,
  read = false,
): void {
  const row = doc.createElement("tr");
  const titleEl = doc.createElement("div");
  titleEl.id = `content-title-${asin}`;
  titleEl.textContent = title;
  row.appendChild(titleEl);
  appendField(doc, row, "div", `content-author-${asin}`, "Synthetic Author");
  appendField(doc, row, "div", `content-acquired-date-${asin}`, date);
  if (rental) appendField(doc, row, "div", `RETURN_CONTENT_ACTION_${asin}`, "");
  if (read) {
    const badge = doc.createElement("span");
    badge.id = "content-read-badge";
    badge.className = "readBadgeText";
    row.appendChild(badge);
  }
  doc.body.appendChild(row);
}

describe("Amazon Books DOM observation", () => {
  it("extracts scoped fields and keeps rental/read semantics", () => {
    const doc = new MockDocument();
    appendRow(doc, "SYNTHETI01", "Synthetic owned candidate", "取得日: 2026年8月8日");
    appendRow(doc, "SYNTHETI02", "Synthetic rental", "レンタル日: 2026年8月8日", true, true);
    appendRow(doc, "INVALID", "Ignored", "取得日: 2026年8月8日");

    assert.deepEqual(parseAmazonBooksDocument(doc), [
      {
        asin: "SYNTHETI01",
        title: "Synthetic owned candidate",
        author: "Synthetic Author",
        acquiredLabel: "取得日: 2026年8月8日",
        isRental: false,
        isRead: false,
      },
      {
        asin: "SYNTHETI02",
        title: "Synthetic rental",
        author: "Synthetic Author",
        acquiredLabel: "レンタル日: 2026年8月8日",
        isRental: true,
        isRead: true,
      },
    ]);
  });

  it("validates the Amazon Books page and does not crawl other pages", () => {
    const doc = new MockDocument();
    assert.equal(isAmazonBooksPageUrl(PAGE_URL), true);
    assert.equal(isAmazonBooksPageUrl("https://www.amazon.com/hz/mycd/digital-console/contentlist/booksAll"), false);
    assert.equal(isAmazonBooksPageUrl("https://www.amazon.co.jp/hz/mycd/digital-console/other"), false);

    const result = readAmazonBooksPage(doc, PAGE_URL);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.pageNumber, 1);
    assert.deepEqual(readAmazonBooksPage(doc, "https://www.amazon.co.jp/"), {
      ok: false,
      error: "amazon_page_required",
    });
  });
});
