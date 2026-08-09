import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  amazonLibraryPageReader,
  isAmazonLibraryPageUrl,
  readAmazonLibraryPage,
} from "../amazon-library.js";
import { handleLibraryReadPage, registerLibraryPageReader } from "../library.js";
import { MockDocument, type MockElement } from "./mock-document.js";

const PAGE_1 = "https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll/";
const PAGE_2 = `${PAGE_1}?pageNumber=2`;

const ASIN = "B0SYNTHE01";

interface VisibilityOptions {
  hidden?: boolean;
  ariaHidden?: boolean;
  display?: string;
  visibility?: string;
  opacity?: string;
  computedDisplay?: string;
  computedVisibility?: string;
  computedOpacity?: string;
}

interface RowOptions {
  titleIdSuffix?: string;
  title?: string;
  author?: string;
  label?: string;
  rentalAction?: boolean;
  imgSrc?: string;
  linkHref?: string;
  parent?: MockElement;
  rowVisibility?: VisibilityOptions;
  titleVisibility?: VisibilityOptions;
  authorVisibility?: VisibilityOptions;
  labelVisibility?: VisibilityOptions;
  rentalActionVisibility?: VisibilityOptions;
  imageVisibility?: VisibilityOptions;
  linkVisibility?: VisibilityOptions;
}

function applyVisibility(element: MockElement, options: VisibilityOptions = {}): void {
  if (options.hidden) element.hidden = true;
  if (options.ariaHidden) element.setAttribute("aria-hidden", "true");
  if (options.display !== undefined) element.style.display = options.display;
  if (options.visibility !== undefined) element.style.visibility = options.visibility;
  if (options.opacity !== undefined) element.style.opacity = options.opacity;
  if (options.computedDisplay !== undefined) element.computedDisplay = options.computedDisplay;
  if (options.computedVisibility !== undefined) {
    element.computedVisibility = options.computedVisibility;
  }
  if (options.computedOpacity !== undefined) element.computedOpacity = options.computedOpacity;
}

function field(
  doc: MockDocument,
  parent: MockElement,
  tag: string,
  id: string,
  text: string,
  visibility: VisibilityOptions = {},
): MockElement {
  const el = doc.createElement(tag);
  el.id = id;
  el.textContent = text;
  applyVisibility(el, visibility);
  parent.appendChild(el);
  return el;
}

function addCount(
  doc: MockDocument,
  total: number,
  visibility: VisibilityOptions = {},
): MockElement {
  const to = total === 0 ? 0 : total;
  return field(
    doc,
    doc.body,
    "div",
    "CONTENT_COUNT",
    `${total}のうち1から${to}までの商品を表示しています`,
    visibility,
  );
}

function addRow(doc: MockDocument, asin: string, opts: RowOptions = {}): MockElement {
  const row = doc.createElement("tr");
  applyVisibility(row, opts.rowVisibility);
  const titleEl = doc.createElement("div");
  titleEl.id = `content-title-${opts.titleIdSuffix ?? asin}`;
  titleEl.textContent = opts.title ?? "Synthetic redacted title";
  applyVisibility(titleEl, opts.titleVisibility);
  row.appendChild(titleEl);
  if (opts.author !== undefined) {
    field(doc, row, "div", `content-author-${asin}`, opts.author, opts.authorVisibility);
  }
  if (opts.label !== undefined) {
    field(doc, row, "div", `content-acquired-date-${asin}`, opts.label, opts.labelVisibility);
  }
  if (opts.rentalAction) {
    field(
      doc,
      row,
      "div",
      `RETURN_CONTENT_ACTION_${asin}`,
      "返却",
      opts.rentalActionVisibility,
    );
  }
  if (opts.imgSrc !== undefined) {
    const img = doc.createElement("img");
    img.setAttribute("src", opts.imgSrc);
    applyVisibility(img, opts.imageVisibility);
    row.appendChild(img);
  }
  if (opts.linkHref !== undefined) {
    const anchor = doc.createElement("a");
    anchor.setAttribute("href", opts.linkHref);
    applyVisibility(anchor, opts.linkVisibility);
    row.appendChild(anchor);
  }
  (opts.parent ?? doc.body).appendChild(row);
  return row;
}

function addPagination(
  doc: MockDocument,
  pageIds: string[],
  nextLabel?: string,
  visibility: VisibilityOptions = {},
  controlVisibility: Record<string, VisibilityOptions> = {},
): MockElement {
  const pager = doc.createElement("div");
  pager.id = "pagination";
  applyVisibility(pager, visibility);
  for (const pageId of pageIds) {
    const anchor = doc.createElement("a");
    anchor.id = pageId;
    applyVisibility(anchor, controlVisibility[pageId]);
    if (pageId === "page-RIGHT_PAGE" && nextLabel !== undefined) {
      anchor.setAttribute("aria-label", nextLabel);
    }
    pager.appendChild(anchor);
  }
  doc.body.appendChild(pager);
  return pager;
}

function appendImage(
  doc: MockDocument,
  parent: MockElement,
  src: string,
  visibility: VisibilityOptions = {},
): MockElement {
  const image = doc.createElement("img");
  image.setAttribute("src", src);
  applyVisibility(image, visibility);
  parent.appendChild(image);
  return image;
}

function appendLink(
  doc: MockDocument,
  parent: MockElement,
  href: string,
  visibility: VisibilityOptions = {},
): MockElement {
  const anchor = doc.createElement("a");
  anchor.setAttribute("href", href);
  applyVisibility(anchor, visibility);
  parent.appendChild(anchor);
  return anchor;
}

describe("Amazon library reader (DOM library-sync protocol)", () => {
  it("registers with the foundation registry under source amazon", () => {
    assert.equal(amazonLibraryPageReader.source, "amazon");
    const unregister = registerLibraryPageReader(amazonLibraryPageReader);
    try {
      const doc = new MockDocument();
      addCount(doc, 1);
      addRow(doc, ASIN, { label: `取得日: 2026年8月8日` });
      const reply = handleLibraryReadPage("amazon", doc, PAGE_1);
      assert.equal(reply.ok, true);
      if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
      assert.deepEqual(reply.items, [{ cid: ASIN, title: "Synthetic redacted title", state: "purchased" }]);
    } finally {
      unregister();
    }
  });

  it("accepts only the HTTPS www.amazon.co.jp Books content-list page with an optional positive pageNumber", () => {
    const valid = [
      PAGE_1,
      "https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll",
      `${PAGE_1}?pageNumber=1`,
      `${PAGE_1}?pageNumber=34`,
    ];
    for (const url of valid) assert.equal(isAmazonLibraryPageUrl(url), true, url);

    const invalid = [
      `http://${new URL(PAGE_1).host}/hz/mycd/digital-console/contentlist/booksAll/`,
      "https://www.amazon.com/hz/mycd/digital-console/contentlist/booksAll",
      "https://www.amazon.co.jp/hz/mycd/digital-console/other",
      "https://www.amazon.co.jp/ap/signin?openid.pape.max_auth_age=0",
      `${PAGE_1}?pageNumber=0`,
      `${PAGE_1}?pageNumber=-1`,
      `${PAGE_1}?pageNumber=abc`,
      "https://user:pw@www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll/",
      `${PAGE_1}#pagination`,
      "https://www.amazon.co.jp:8443/hz/mycd/digital-console/contentlist/booksAll/",
    ];
    for (const url of invalid) assert.equal(isAmazonLibraryPageUrl(url), false, url);
  });

  it("rejects non-default port product links and does not emit them", () => {
    const doc = new MockDocument();
    addCount(doc, 1);
    addRow(doc, ASIN, {
      label: "取得日: 2026年8月8日",
      linkHref: "https://www.amazon.co.jp:8443/dp/B0SYNTHE01",
    });
    const reply = readAmazonLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.equal(reply.items[0]?.productUrl, undefined);
  });

  it("classifies a page outside the library path as login", () => {
    const doc = new MockDocument();
    addCount(doc, 1);
    addRow(doc, ASIN, { label: `取得日: 2026年8月8日` });
    const reply = readAmazonLibraryPage(
      doc,
      "https://www.amazon.co.jp/ap/signin?openid.pape.max_auth_age=0",
    );
    assert.deepEqual(reply, {
      ok: true,
      state: "login",
      pageUrl: "https://www.amazon.co.jp/ap/signin?openid.pape.max_auth_age=0",
    });
  });

  it("reports page_not_ready while count and rows are still missing", () => {
    const doc = new MockDocument();
    assert.deepEqual(readAmazonLibraryPage(doc, PAGE_1), {
      ok: true,
      state: "page_not_ready",
      pageUrl: PAGE_1,
    });
  });

  it("fails closed as page_not_ready when the count claims items but no visible row matches", () => {
    const doc = new MockDocument();
    addCount(doc, 2);
    assert.deepEqual(readAmazonLibraryPage(doc, PAGE_1), {
      ok: true,
      state: "page_not_ready",
      pageUrl: PAGE_1,
    });
  });

  it("reports an empty library when the visible count is zero", () => {
    const doc = new MockDocument();
    addCount(doc, 0);
    assert.deepEqual(readAmazonLibraryPage(doc, PAGE_1), {
      ok: true,
      state: "empty",
      pageUrl: PAGE_1,
      items: [],
      nextPageUrl: null,
    });
  });

  it("maps 取得日 to purchased with visible title, author, image and product link", () => {
    const doc = new MockDocument();
    addCount(doc, 1);
    addRow(doc, ASIN, {
      title: "Synthetic owned candidate",
      author: "Synthetic Author",
      label: "取得日: 2026年8月8日",
      imgSrc: "https://m.media-amazon.com/images/I/51Redacted.jpg",
      linkHref: "https://www.amazon.co.jp/dp/B0SYNTHE01?ref=redacted",
    });
    const reply = readAmazonLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.deepEqual(reply.items, [
      {
        cid: ASIN,
        title: "Synthetic owned candidate",
        state: "purchased",
        maker: "Synthetic Author",
        imageUrl: "https://m.media-amazon.com/images/I/51Redacted.jpg",
        productUrl: "https://www.amazon.co.jp/dp/B0SYNTHE01",
      },
    ]);
    assert.equal(reply.nextPageUrl, null);
  });

  it("uses only visible rows and fields, preferring visible same-id candidates", () => {
    const doc = new MockDocument();
    addCount(doc, 4);

    const hiddenRow = doc.createElement("section");
    hiddenRow.computedDisplay = "none";
    doc.body.appendChild(hiddenRow);
    addRow(doc, "ROWHIDDEN1", {
      title: "Synthetic hidden ancestor row",
      label: "取得日: 2026年8月8日",
      parent: hiddenRow,
    });
    addRow(doc, "HIDDENROW1", {
      title: "Synthetic hidden row",
      rowVisibility: { hidden: true },
      label: "取得日: 2026年8月8日",
    });

    addRow(doc, "TITLEHID01", {
      title: "Synthetic aria-hidden title",
      titleVisibility: { ariaHidden: true },
      label: "取得日: 2026年8月8日",
    });
    addRow(doc, "TITLEHID01", {
      title: "Synthetic visible duplicate title",
      label: "Prime Reading",
    });

    const stateRow = addRow(doc, "STATEHID01", {
      label: "取得日: 2026年8月8日",
      labelVisibility: { visibility: "collapse" },
    });
    const visibleStateLabel = field(
      doc,
      stateRow,
      "div",
      "content-acquired-date-STATEHID01",
      "",
    );
    const hiddenLabelText = doc.createElement("span");
    hiddenLabelText.textContent = "取得日: 2026年8月8日";
    hiddenLabelText.hidden = true;
    visibleStateLabel.appendChild(hiddenLabelText);
    visibleStateLabel.appendChild(doc.createTextNode("Prime Reading"));

    const imageRow = addRow(doc, "IMAGEHID01", {
      author: "Synthetic hidden author",
      authorVisibility: { ariaHidden: true },
      imgSrc: "https://images.example.invalid/hidden.jpg",
      imageVisibility: { display: "none" },
    });
    appendImage(doc, imageRow, "https://images.example.invalid/visible.jpg");

    const linkRow = addRow(doc, "LINKHID001", {
      linkHref: "https://www.amazon.co.jp/dp/LINKHID001",
      linkVisibility: { opacity: "0" },
    });
    appendLink(doc, linkRow, "https://www.amazon.co.jp/dp/LINKHID001?ref=visible");

    const reply = readAmazonLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.deepEqual(reply.items, [
      {
        cid: "TITLEHID01",
        title: "Synthetic visible duplicate title",
        state: "unknown",
      },
      {
        cid: "STATEHID01",
        title: "Synthetic redacted title",
        state: "unknown",
      },
      {
        cid: "IMAGEHID01",
        title: "Synthetic redacted title",
        state: "unknown",
        imageUrl: "https://images.example.invalid/visible.jpg",
      },
      {
        cid: "LINKHID001",
        title: "Synthetic redacted title",
        state: "unknown",
        productUrl: "https://www.amazon.co.jp/dp/LINKHID001",
      },
    ]);
  });

  it("keeps レンタル日 and the visible return action rental", () => {
    const doc = new MockDocument();
    addCount(doc, 2);
    addRow(doc, "RENTALSY01", { label: "レンタル日: 2026年8月8日" });
    addRow(doc, "RENTALSY02", { label: "取得日: 2026年8月8日", rentalAction: true });
    const reply = readAmazonLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.deepEqual(reply.items.map((item) => item.state), ["rental", "rental"]);
  });

  it("fail-closes when the same row mixes 取得日 with non-purchase markers", () => {
    const doc = new MockDocument();
    addCount(doc, 7);

    const primeRow = addRow(doc, "CONFLICT01", { label: "取得日: 2026年8月8日" });
    field(doc, primeRow, "div", "content-badge-CONFLICT01", "Prime Reading");

    const kuRow = addRow(doc, "CONFLICT02", { label: "取得日: 2026年8月8日" });
    field(doc, kuRow, "span", "content-badge-CONFLICT02", "Kindle Unlimited");

    const sampleRow = addRow(doc, "CONFLICT03", { label: "取得日: 2026年8月8日" });
    field(doc, sampleRow, "span", "content-badge-CONFLICT03", "サンプル");

    const freeRow = addRow(doc, "CONFLICT04", { label: "取得日: 2026年8月8日" });
    field(doc, freeRow, "span", "content-badge-CONFLICT04", "無料");

    const freeEnRow = addRow(doc, "CONFLICT05", { label: "取得日: 2026年8月8日" });
    field(doc, freeEnRow, "span", "content-badge-CONFLICT05", "free");

    const returnedRow = addRow(doc, "CONFLICT06", { label: "取得日: 2026年8月8日" });
    field(doc, returnedRow, "span", "content-badge-CONFLICT06", "返品済み");

    const refundedRow = addRow(doc, "CONFLICT07", { label: "取得日: 2026年8月8日" });
    field(doc, refundedRow, "span", "content-badge-CONFLICT07", "返金");

    const reply = readAmazonLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.deepEqual(
      reply.items.map((item) => ({ cid: item.cid, state: item.state })),
      [
        { cid: "CONFLICT01", state: "unknown" },
        { cid: "CONFLICT02", state: "unknown" },
        { cid: "CONFLICT03", state: "unknown" },
        { cid: "CONFLICT04", state: "free" },
        { cid: "CONFLICT05", state: "free" },
        { cid: "CONFLICT06", state: "unknown" },
        { cid: "CONFLICT07", state: "unknown" },
      ],
    );
  });

  it("maps free/returned markers without 取得日 and keeps pure 取得日 as purchased", () => {
    const doc = new MockDocument();
    addCount(doc, 4);
    addRow(doc, "FREESTATE1", { label: "無料" });
    addRow(doc, "RETURNED01", { label: "返品" });
    addRow(doc, "REFUNDED01", { label: "返金済み" });
    // Explicit purchased evidence with no free/return markers (incl. zero-price case).
    addRow(doc, "PURCHASED1", { label: "取得日: 2026年8月8日" });
    const reply = readAmazonLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.deepEqual(
      reply.items.map((item) => ({ cid: item.cid, state: item.state })),
      [
        { cid: "FREESTATE1", state: "free" },
        { cid: "RETURNED01", state: "unknown" },
        { cid: "REFUNDED01", state: "unknown" },
        { cid: "PURCHASED1", state: "purchased" },
      ],
    );
  });

  it("leaves Prime/subscription/sample/unsupported or missing labels unknown and never infers ownership from the title", () => {
    const doc = new MockDocument();
    addCount(doc, 4);
    addRow(doc, "UNKNOWNS01", { label: "Prime Reading" });
    addRow(doc, "UNKNOWNS02", { label: "サンプル" });
    addRow(doc, "UNKNOWNS03", { label: "配信日: 2026年8月8日" });
    addRow(doc, "UNKNOWNS04");
    const reply = readAmazonLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    for (const item of reply.items) {
      assert.equal(item.state, "unknown");
      assert.equal(item.cid.startsWith("UNKNOWNS"), true);
    }
  });

  it("ignores malformed and bulk-dialog ids and duplicate rows", () => {
    const doc = new MockDocument();
    addCount(doc, 4);
    addRow(doc, "MALFORMS01", { titleIdSuffix: `${"MALFORMS01"}:KindleEBook`, label: "取得日: 2026年8月8日" });
    addRow(doc, "MALFORMSY02", { titleIdSuffix: "MALFORMSY", label: "取得日: 2026年8月8日" });
    addRow(doc, "MALFORMSY03", { titleIdSuffix: "malformsy03", label: "取得日: 2026年8月8日" });
    addRow(doc, "MALFORMS04", { titleIdSuffix: "MALFORMSY04!?", label: "取得日: 2026年8月8日" });
    addRow(doc, "MALFORMS05", { label: "取得日: 2026年8月8日" });
    addRow(doc, "MALFORMS05", { label: "取得日: 2026年8月9日" });
    // Title node not inside a row: no row boundary, ignored.
    field(doc, doc.body, "div", "content-title-MALFORMSY06", "取得日: 2026年8月8日");
    const reply = readAmazonLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.deepEqual(reply.items, [
      { cid: "MALFORMS05", title: "Synthetic redacted title", state: "purchased" },
    ]);
  });

  it("preserves absolute http(s) images without credentials only", () => {
    const doc = new MockDocument();
    addCount(doc, 3);
    addRow(doc, "IMAGESY001", {
      imgSrc: "https://m.media-amazon.com/images/I/51Redacted.jpg",
    });
    addRow(doc, "IMAGESY002", { imgSrc: "http://images.example.com/redacted.jpg" });
    addRow(doc, "IMAGESY003", { imgSrc: "/images/relative.jpg" });
    addRow(doc, "IMAGESY004", {
      imgSrc: "https://user:pw@images.example.com/redacted.jpg",
    });
    const reply = readAmazonLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.deepEqual(
      reply.items.map((item) => item.imageUrl ?? null),
      [
        "https://m.media-amazon.com/images/I/51Redacted.jpg",
        "http://images.example.com/redacted.jpg",
        null,
        null,
      ],
    );
  });

  it("preserves a productUrl only for a visible HTTPS product link and never invents one from the ASIN", () => {
    const doc = new MockDocument();
    addCount(doc, 4);
    addRow(doc, "LINKSY0001", {
      linkHref: "https://www.amazon.co.jp/gp/product/LINKSY0001?ref=redacted",
    });
    addRow(doc, "LINKSY0002", { linkHref: "javascript:void(0)" });
    addRow(doc, "LINKSY0003", {
      linkHref: "https://www.amazon.co.jp/gp/help/customer/display.html",
    });
    addRow(doc, "LINKSY0004");
    const reply = readAmazonLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.deepEqual(
      reply.items.map((item) => item.productUrl ?? null),
      [
      "https://www.amazon.co.jp/gp/product/LINKSY0001",
        null,
        null,
        null,
      ],
    );
  });

  it("drives a bounded next URL from the visible pager on the existing pageNumber route", () => {
    const doc = new MockDocument();
    addCount(doc, 34);
    addRow(doc, ASIN, { label: `取得日: 2026年8月8日` });
    addPagination(doc, ["page-1", "page-2", "page-34", "page-RIGHT_PAGE"], "Next");
    const reply = readAmazonLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.equal(reply.pageUrl, PAGE_1);
    assert.equal(reply.nextPageUrl, `${PAGE_1}?pageNumber=2`);
  });

  it("uses the page-number anchors as next-page proof and canonicalizes page URLs", () => {
    const doc = new MockDocument();
    addCount(doc, 5);
    addRow(doc, ASIN, { label: `取得日: 2026年8月8日` });
    addPagination(doc, ["page-1", "page-2", "page-3"]);
    const messy = `${PAGE_1}?ref=mycd_redacted&dateDsc&pageNumber=2`;
    const reply = readAmazonLibraryPage(doc, messy);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.equal(reply.pageUrl, PAGE_2);
    assert.equal(reply.nextPageUrl, `${PAGE_1}?pageNumber=3`);
  });

  it("emits no next URL when the visible pager proves no later page", () => {
    const doc = new MockDocument();
    addCount(doc, 2);
    addRow(doc, ASIN, { label: `取得日: 2026年8月8日` });
    addPagination(doc, ["page-1", "page-2"]);
    const reply = readAmazonLibraryPage(doc, PAGE_2);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.equal(reply.nextPageUrl, null);
  });

  it("emits no next URL when the pager is absent or the next control has no Next label", () => {
    for (const pageIds of [[], ["page-1", "page-RIGHT_PAGE"]]) {
      const doc = new MockDocument();
      addCount(doc, 2);
      addRow(doc, ASIN, { label: `取得日: 2026年8月8日` });
      if (pageIds.length > 0) addPagination(doc, pageIds);
      const reply = readAmazonLibraryPage(doc, PAGE_1);
      assert.equal(reply.ok, true);
      if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
      assert.equal(reply.nextPageUrl, null, pageIds.join(","));
    }
  });

  it("ignores invisible counts, pagers, and paging controls", () => {
    const hiddenPagerDoc = new MockDocument();
    addCount(hiddenPagerDoc, 0, { computedDisplay: "none" });
    addCount(hiddenPagerDoc, 1);
    addRow(hiddenPagerDoc, ASIN, { label: "Prime Reading" });
    addPagination(
      hiddenPagerDoc,
      ["page-1", "page-99", "page-RIGHT_PAGE"],
      "Next",
      { ariaHidden: true },
    );
    addPagination(hiddenPagerDoc, ["page-1"]);

    const hiddenPagerReply = readAmazonLibraryPage(hiddenPagerDoc, PAGE_1);
    assert.equal(hiddenPagerReply.ok, true);
    if (!hiddenPagerReply.ok || hiddenPagerReply.state !== "ready") {
      throw new Error("expected ready");
    }
    assert.equal(hiddenPagerReply.nextPageUrl, null);

    const hiddenAnchorDoc = new MockDocument();
    addCount(hiddenAnchorDoc, 2);
    addRow(hiddenAnchorDoc, ASIN, { label: "Prime Reading" });
    addPagination(
      hiddenAnchorDoc,
      ["page-2", "page-34"],
      undefined,
      {},
      { "page-34": { computedOpacity: "0" } },
    );
    const hiddenAnchorReply = readAmazonLibraryPage(hiddenAnchorDoc, PAGE_2);
    assert.equal(hiddenAnchorReply.ok, true);
    if (!hiddenAnchorReply.ok || hiddenAnchorReply.state !== "ready") {
      throw new Error("expected ready");
    }
    assert.equal(hiddenAnchorReply.nextPageUrl, null);

    const hiddenNextDoc = new MockDocument();
    addCount(hiddenNextDoc, 2);
    addRow(hiddenNextDoc, ASIN, { label: "Prime Reading" });
    addPagination(
      hiddenNextDoc,
      ["page-1", "page-2", "page-RIGHT_PAGE"],
      "Next",
      {},
      { "page-RIGHT_PAGE": { visibility: "collapse" } },
    );
    const hiddenNextReply = readAmazonLibraryPage(hiddenNextDoc, PAGE_1);
    assert.equal(hiddenNextReply.ok, true);
    if (!hiddenNextReply.ok || hiddenNextReply.state !== "ready") {
      throw new Error("expected ready");
    }
    assert.equal(hiddenNextReply.nextPageUrl, PAGE_2);
  });
});
