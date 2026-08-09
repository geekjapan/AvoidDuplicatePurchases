import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ebookjapanLibraryPageReader,
  isEbookjapanLibraryPageUrl,
  readEbookjapanLibraryPage,
} from "../ebookjapan-library.js";
import { handleLibraryReadPage, registerLibraryPageReader } from "../library.js";
import { MockDocument, type MockElement } from "./mock-document.js";

const PAGE_1 = "https://ebookjapan.yahoo.co.jp/bookshelf/";
const PAGE_2 = `${PAGE_1}?page=2`;
const PUBLICATION_CD = "A00SYNTH01";
const PRODUCT_HREF = `https://ebookjapan.yahoo.co.jp/books/100001/${PUBLICATION_CD}/`;

function el(
  doc: MockDocument,
  parent: MockElement,
  tag: string,
  opts: {
    id?: string;
    className?: string;
    text?: string;
    href?: string;
    attrs?: Record<string, string>;
  } = {},
): MockElement {
  const node = doc.createElement(tag);
  if (opts.id) node.id = opts.id;
  if (opts.className) node.className = opts.className;
  if (opts.text !== undefined) node.textContent = opts.text;
  if (opts.href !== undefined) node.setAttribute("href", opts.href);
  if (opts.attrs) {
    for (const [name, value] of Object.entries(opts.attrs)) {
      node.setAttribute(name, value);
    }
  }
  parent.appendChild(node);
  return node;
}

function addShell(
  doc: MockDocument,
  opts: {
    heading?: string;
    activeTab?: "purchased" | "free_history" | "other" | "none";
    amount?: string;
    empty?: boolean;
  } = {},
): MockElement {
  el(doc, doc.body, "h1", {
    className: "heading__main",
    text: opts.heading ?? "単行本・冊（すべて）",
  });
  const menu = el(doc, doc.body, "ul", { className: "tab-menu-list" });
  const active = opts.activeTab ?? "purchased";
  const purchased = el(doc, menu, "li", {
    className: active === "purchased" ? "is-active" : "",
    text: "購入済み",
  });
  const free = el(doc, menu, "li", {
    className: active === "free_history" ? "is-active" : "",
    text: "無料読書履歴",
  });
  if (active === "other") {
    el(doc, menu, "li", { className: "is-active", text: "お気に入り" });
  }
  void purchased;
  void free;
  el(doc, doc.body, "div", {
    className: "shelf-control__amount",
    text: opts.amount ?? "0冊",
  });
  const shelf = el(doc, doc.body, "div", { id: "wd_temp_shelf-main" });
  el(doc, shelf, "div", { className: "contents-book-wrapper" });
  if (opts.empty) {
    el(doc, shelf, "div", {
      className: "zero-message zero-message--shelf",
      text: "本がありません。",
    });
  }
  return shelf;
}

function addItem(
  doc: MockDocument,
  shelf: MockElement,
  opts: {
    cid?: string;
    title?: string;
    href?: string | null;
    imgSrc?: string;
    imgAlt?: string;
    badge?: string;
    wrapperClass?: string;
  } = {},
): MockElement {
  const cid = opts.cid ?? PUBLICATION_CD;
  const wrapper = el(doc, shelf, "div", {
    className: opts.wrapperClass ?? "contents-book",
  });
  if (opts.href === null) {
    el(doc, wrapper, "span", { text: opts.title ?? "Synthetic redacted title" });
    return wrapper;
  }
  const href =
    opts.href ?? `https://ebookjapan.yahoo.co.jp/books/100001/${cid}/`;
  const title = opts.title ?? "Synthetic redacted title";
  // Badge text is visible evidence on the same item boundary (the product link).
  const anchorText = opts.badge ? `${title} ${opts.badge}` : title;
  const anchor = el(doc, wrapper, "a", { href, text: anchorText });
  if (opts.imgSrc !== undefined || opts.imgAlt !== undefined) {
    // Rebuild children: image + title/badge text (textContent setter clears kids).
    const img = doc.createElement("img");
    if (opts.imgSrc !== undefined) img.setAttribute("src", opts.imgSrc);
    if (opts.imgAlt !== undefined) img.setAttribute("alt", opts.imgAlt);
    const label = doc.createElement("span");
    label.textContent = anchorText;
    anchor.textContent = "";
    anchor.appendChild(img);
    anchor.appendChild(label);
  }
  return wrapper;
}

type InvisibleDomState =
  | "hidden"
  | "aria-hidden"
  | "display-none"
  | "visibility-hidden"
  | "visibility-collapse"
  | "opacity-zero";

const INVISIBLE_DOM_STATES: InvisibleDomState[] = [
  "hidden",
  "aria-hidden",
  "display-none",
  "visibility-hidden",
  "visibility-collapse",
  "opacity-zero",
];

function markInvisible(node: MockElement, state: InvisibleDomState): void {
  switch (state) {
    case "hidden":
      node.setAttribute("hidden", "");
      return;
    case "aria-hidden":
      node.setAttribute("aria-hidden", "true");
      return;
    case "display-none":
      node.computedDisplay = "none";
      return;
    case "visibility-hidden":
      node.computedVisibility = "hidden";
      return;
    case "visibility-collapse":
      node.computedVisibility = "collapse";
      return;
    case "opacity-zero":
      node.computedOpacity = "0";
      return;
  }
}

function markShellInvisible(
  doc: MockDocument,
  shelf: MockElement,
  state: InvisibleDomState,
): void {
  markInvisible(shelf, state);
  for (const selector of [".heading__main", ".tab-menu-list", ".shelf-control__amount"]) {
    const candidate = doc.querySelectorAll(selector)[0];
    assert.ok(candidate);
    markInvisible(candidate, state);
  }
}

describe("ebookjapan library reader (DOM library-sync protocol)", () => {
  it("registers with the foundation registry under source ebookjapan", () => {
    assert.equal(ebookjapanLibraryPageReader.source, "ebookjapan");
    const unregister = registerLibraryPageReader(ebookjapanLibraryPageReader);
    try {
      const doc = new MockDocument();
      const shelf = addShell(doc, { amount: "1冊" });
      addItem(doc, shelf);
      const reply = handleLibraryReadPage("ebookjapan", doc, PAGE_1);
      assert.equal(reply.ok, true);
      if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
      assert.deepEqual(reply.items, [
        {
          cid: PUBLICATION_CD,
          title: "Synthetic redacted title",
          state: "purchased",
          productUrl: PRODUCT_HREF,
        },
      ]);
    } finally {
      unregister();
    }
  });

  it("accepts only the exact HTTPS ebookjapan.yahoo.co.jp bookshelf path with at most one positive page query", () => {
    const valid = [
      PAGE_1,
      "https://ebookjapan.yahoo.co.jp/bookshelf",
      `${PAGE_1}?page=1`,
      `${PAGE_1}?page=34`,
    ];
    for (const url of valid) assert.equal(isEbookjapanLibraryPageUrl(url), true, url);

    const invalid = [
      "http://ebookjapan.yahoo.co.jp/bookshelf/",
      "https://ebookjapan.yahoo.com/bookshelf/",
      "https://ebookjapan.yahoo.co.jp/books/100001/A00SYNTH01/",
      "https://ebookjapan.yahoo.co.jp/mypage/history",
      "https://login.yahoo.co.jp/config/login",
      // Subpaths of /bookshelf are never canonical bookshelf pages.
      "https://ebookjapan.yahoo.co.jp/bookshelf/all",
      "https://ebookjapan.yahoo.co.jp/bookshelf/all?page=2",
      // Non-page query keys, duplicate page values, and empty values fail closed.
      `${PAGE_1}?page=2&ref=tracking`,
      `${PAGE_1}?ref=tracking`,
      `${PAGE_1}?foo=1`,
      `${PAGE_1}?page=2&page=3`,
      `${PAGE_1}?page=2&page=2`,
      `${PAGE_1}?page=`,
      `${PAGE_1}?page=0`,
      `${PAGE_1}?page=-1`,
      `${PAGE_1}?page=abc`,
      "https://user:pw@ebookjapan.yahoo.co.jp/bookshelf/",
      `${PAGE_1}#shelf`,
      "https://ebookjapan.yahoo.co.jp:8443/bookshelf/",
    ];
    for (const url of invalid) assert.equal(isEbookjapanLibraryPageUrl(url), false, url);
  });

  it("fails closed on subpaths and extra query keys and canonicalizes accepted page URLs", () => {
    const doc = new MockDocument();
    const shelf = addShell(doc, { amount: "1冊" });
    addItem(doc, shelf);

    // Non-canonical URLs are rejected at the gate, never canonicalized into
    // a bookshelf observation.
    for (const url of [
      "https://ebookjapan.yahoo.co.jp/bookshelf/all?page=2&ref=tracking",
      `${PAGE_1}?page=2&ref=tracking`,
      `${PAGE_1}?ref=tracking`,
    ]) {
      assert.deepEqual(readEbookjapanLibraryPage(doc, url), {
        ok: true,
        state: "login",
        pageUrl: url,
      });
    }

    const reply = readEbookjapanLibraryPage(doc, `${PAGE_1}?page=2`);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.equal(reply.pageUrl, PAGE_2);
    assert.doesNotMatch(reply.pageUrl, /\/bookshelf\/all/);
  });

  it("classifies a page outside the bookshelf path as login", () => {
    const doc = new MockDocument();
    addShell(doc, { empty: true });
    const reply = readEbookjapanLibraryPage(
      doc,
      "https://login.yahoo.co.jp/config/login",
    );
    assert.deepEqual(reply, {
      ok: true,
      state: "login",
      pageUrl: "https://login.yahoo.co.jp/config/login",
    });
  });

  it("reports page_not_ready while the bookshelf shell is still missing", () => {
    const doc = new MockDocument();
    assert.deepEqual(readEbookjapanLibraryPage(doc, PAGE_1), {
      ok: true,
      state: "page_not_ready",
      pageUrl: PAGE_1,
    });
  });

  it("reports an empty purchased shelf from the observed zero-message marker", () => {
    const doc = new MockDocument();
    addShell(doc, { empty: true, amount: "0冊" });
    assert.deepEqual(readEbookjapanLibraryPage(doc, PAGE_1), {
      ok: true,
      state: "empty",
      pageUrl: PAGE_1,
      items: [],
      nextPageUrl: null,
    });
  });

  it("fails closed as page_not_ready when the purchased shelf is non-empty but no product-link item boundary is visible", () => {
    const doc = new MockDocument();
    const shelf = addShell(doc, { amount: "2冊" });
    // Title-only node with no product link: must not invent ownership or URL.
    el(doc, shelf, "div", { text: "Synthetic redacted title" });
    assert.deepEqual(readEbookjapanLibraryPage(doc, PAGE_1), {
      ok: true,
      state: "page_not_ready",
      pageUrl: PAGE_1,
    });
  });

  it("maps purchased-tab product links to purchased with visible title, image and product link", () => {
    const doc = new MockDocument();
    const shelf = addShell(doc, { amount: "1冊" });
    addItem(doc, shelf, {
      title: "Synthetic owned candidate",
      imgSrc: "https://s.yimg.jp/images/ebookjapan/redacted.jpg",
    });
    const reply = readEbookjapanLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.deepEqual(reply.items, [
      {
        cid: PUBLICATION_CD,
        title: "Synthetic owned candidate",
        state: "purchased",
        imageUrl: "https://s.yimg.jp/images/ebookjapan/redacted.jpg",
        productUrl: PRODUCT_HREF,
      },
    ]);
    assert.equal(reply.nextPageUrl, null);
  });

  it("never treats the separate free-reading-history tab as purchased content", () => {
    const doc = new MockDocument();
    const shelf = addShell(doc, { activeTab: "free_history", amount: "1冊" });
    addItem(doc, shelf, { cid: "A00FREE0001", title: "Synthetic free history" });
    const reply = readEbookjapanLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.deepEqual(reply.items, [
      {
        cid: "A00FREE0001",
        title: "Synthetic free history",
        state: "free",
        productUrl: "https://ebookjapan.yahoo.co.jp/books/100001/A00FREE0001/",
      },
    ]);
  });

  it("keeps rental/sample/gift/reservation/ambiguous markers non-purchased and never infers ownership from the title alone", () => {
    const doc = new MockDocument();
    const shelf = addShell(doc, { amount: "5冊" });
    addItem(doc, shelf, { cid: "A00RENTAL01", title: "Synthetic", badge: "レンタル中" });
    addItem(doc, shelf, { cid: "A00SAMPLE01", title: "Synthetic", badge: "立ち読み" });
    addItem(doc, shelf, { cid: "A00GIFT0001", title: "Synthetic", badge: "ギフト" });
    addItem(doc, shelf, { cid: "A00RESERV01", title: "Synthetic", badge: "予約" });
    // Ambiguous active tab elsewhere would fail closed; on purchased tab with
    // no non-purchased marker the product-link boundary is purchased evidence.
    const reply = readEbookjapanLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.deepEqual(
      reply.items.map((item) => [item.cid, item.state]),
      [
        ["A00RENTAL01", "rental"],
        ["A00SAMPLE01", "sample"],
        ["A00GIFT0001", "gift"],
        ["A00RESERV01", "reservation"],
      ],
    );
  });

  it("fails closed when the active tab is not the purchased shelf", () => {
    const doc = new MockDocument();
    const shelf = addShell(doc, { activeTab: "other", amount: "1冊" });
    addItem(doc, shelf);
    assert.deepEqual(readEbookjapanLibraryPage(doc, PAGE_1), {
      ok: true,
      state: "page_not_ready",
      pageUrl: PAGE_1,
    });
  });

  it("ignores non-product links, credentialed URLs, and duplicate publicationCd rows", () => {
    const doc = new MockDocument();
    const shelf = addShell(doc, { amount: "4冊" });
    addItem(doc, shelf, {
      cid: "A00KEEP0001",
      title: "Keep",
      href: "https://ebookjapan.yahoo.co.jp/books/1/A00KEEP0001/",
    });
    addItem(doc, shelf, {
      cid: "A00KEEP0001",
      title: "Duplicate",
      href: "https://ebookjapan.yahoo.co.jp/books/1/A00KEEP0001/?ref=dup",
    });
    addItem(doc, shelf, {
      cid: "A00HELP",
      title: "Help",
      href: "https://ebookjapan.yahoo.co.jp/info/notice/",
    });
    addItem(doc, shelf, {
      cid: "A00CREDS",
      title: "Creds",
      href: "https://user:pw@ebookjapan.yahoo.co.jp/books/1/A00CREDS01/",
    });
    addItem(doc, shelf, {
      cid: "A00JS",
      title: "Js",
      href: "javascript:void(0)",
    });
    const reply = readEbookjapanLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.deepEqual(reply.items, [
      {
        cid: "A00KEEP0001",
        title: "Keep",
        state: "purchased",
        productUrl: "https://ebookjapan.yahoo.co.jp/books/1/A00KEEP0001/",
      },
    ]);
  });

  it("preserves absolute http(s) images without credentials only", () => {
    const doc = new MockDocument();
    const shelf = addShell(doc, { amount: "4冊" });
    addItem(doc, shelf, {
      cid: "A00IMG00001",
      imgSrc: "https://s.yimg.jp/images/ebookjapan/redacted.jpg",
    });
    addItem(doc, shelf, {
      cid: "A00IMG00002",
      imgSrc: "http://images.example.com/redacted.jpg",
    });
    addItem(doc, shelf, { cid: "A00IMG00003", imgSrc: "/images/relative.jpg" });
    addItem(doc, shelf, {
      cid: "A00IMG00004",
      imgSrc: "https://user:pw@images.example.com/redacted.jpg",
    });
    const reply = readEbookjapanLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.deepEqual(
      reply.items.map((item) => item.imageUrl ?? null),
      [
        "https://s.yimg.jp/images/ebookjapan/redacted.jpg",
        "http://images.example.com/redacted.jpg",
        null,
        null,
      ],
    );
  });

  it("preserves a productUrl only for a visible HTTPS ebookjapan product link and never invents one", () => {
    const doc = new MockDocument();
    const shelf = addShell(doc, { amount: "2冊" });
    addItem(doc, shelf, {
      cid: "A00LINK0001",
      href: "https://ebookjapan.yahoo.co.jp/books/9/A00LINK0001/?ref=redacted",
    });
    // Title without href: no productUrl invented from the publicationCd.
    addItem(doc, shelf, { cid: "A00LINK0002", href: null, title: "No link" });
    const reply = readEbookjapanLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.deepEqual(reply.items.map((item) => item.productUrl ?? null), [
      "https://ebookjapan.yahoo.co.jp/books/9/A00LINK0001/",
    ]);
  });

  it("drives a bounded next URL from a visible same-host bookshelf page link", () => {
    const doc = new MockDocument();
    const shelf = addShell(doc, { amount: "30冊" });
    addItem(doc, shelf);
    el(doc, doc.body, "a", { href: `${PAGE_1}?page=2`, text: "2" });
    el(doc, doc.body, "a", { href: `${PAGE_1}?page=3`, text: "3" });
    const reply = readEbookjapanLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.equal(reply.pageUrl, PAGE_1);
    assert.equal(reply.nextPageUrl, PAGE_2);
  });

  it("canonicalizes accepted page URLs and only follows clean exact-path next links", () => {
    const doc = new MockDocument();
    const shelf = addShell(doc, { amount: "30冊" });
    addItem(doc, shelf);
    // Query-carrying and subpath links are not pagination evidence.
    el(doc, doc.body, "a", {
      href: "/bookshelf/?page=3&ref=redacted",
      text: "次へ",
    });
    el(doc, doc.body, "a", { href: "/bookshelf/?page=3", text: "3" });
    const reply = readEbookjapanLibraryPage(doc, `${PAGE_1}?page=2`);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.equal(reply.pageUrl, PAGE_2);
    assert.equal(reply.nextPageUrl, `${PAGE_1}?page=3`);

    // Only the exact-path single-page-query link counts: the 次へ link with
    // an extra query key alone emits no next URL.
    const dirtyOnly = new MockDocument();
    const shelf2 = addShell(dirtyOnly, { amount: "30冊" });
    addItem(dirtyOnly, shelf2);
    el(dirtyOnly, dirtyOnly.body, "a", {
      href: "/bookshelf/?page=3&ref=redacted",
      text: "次へ",
    });
    const strict = readEbookjapanLibraryPage(dirtyOnly, PAGE_1);
    assert.equal(strict.ok, true);
    if (!strict.ok || strict.state !== "ready") throw new Error("expected ready");
    assert.equal(strict.nextPageUrl, null);
  });

  it("emits no next URL when no later visible bookshelf control exists", () => {
    const doc = new MockDocument();
    const shelf = addShell(doc, { amount: "2冊" });
    addItem(doc, shelf);
    el(doc, doc.body, "a", { href: `${PAGE_1}?page=1`, text: "1" });
    el(doc, doc.body, "a", { href: "https://evil.example.com/bookshelf/?page=2", text: "2" });
    const reply = readEbookjapanLibraryPage(doc, PAGE_2);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.equal(reply.nextPageUrl, null);
  });

  it("uses visible same-name shell, tab, empty marker, item, image, product link, and paging candidates only", () => {
    for (const state of INVISIBLE_DOM_STATES) {
      const doc = new MockDocument();
      const hiddenShell = addShell(doc, {
        activeTab: "other",
        amount: "99冊",
        empty: true,
      });
      markShellInvisible(doc, hiddenShell, state);

      const visibleShelf = addShell(doc, { activeTab: "purchased", amount: "1冊" });
      const hiddenEmpty = el(doc, visibleShelf, "div", {
        className: "zero-message zero-message--shelf",
        text: "本がありません。",
      });
      markInvisible(hiddenEmpty, state);

      const hiddenItem = addItem(doc, visibleShelf, {
        cid: "A00HIDDEN01",
        title: "Synthetic hidden item",
        imgSrc: "https://images.example.com/hidden.jpg",
      });
      markInvisible(hiddenItem, state);

      const visibleItem = addItem(doc, visibleShelf, {
        cid: "A00VISIBLE1",
        title: "Synthetic visible item",
      });
      const visibleAnchor = visibleItem.querySelector("a");
      assert.ok(visibleAnchor);
      const hiddenImage = doc.createElement("img");
      hiddenImage.setAttribute("src", "https://images.example.com/hidden-marker.jpg");
      markInvisible(hiddenImage, state);
      visibleAnchor.appendChild(hiddenImage);
      const visibleImage = doc.createElement("img");
      visibleImage.setAttribute("src", "https://images.example.com/visible.jpg");
      visibleAnchor.appendChild(visibleImage);
      const hiddenPurchaseMarker = el(doc, visibleAnchor, "span", {
        text: "購入済み",
      });
      markInvisible(hiddenPurchaseMarker, state);

      const hiddenNext = el(doc, doc.body, "a", {
        href: `${PAGE_1}?page=3`,
        text: "3",
      });
      markInvisible(hiddenNext, state);
      el(doc, doc.body, "a", {
        href: `${PAGE_1}?page=2`,
        text: "2",
      });

      const reply = readEbookjapanLibraryPage(doc, PAGE_1);
      assert.equal(reply.ok, true, state);
      if (!reply.ok || reply.state !== "ready") {
        throw new Error(`expected ready (${state}: ${JSON.stringify(reply)})`);
      }
      assert.deepEqual(reply.items, [
        {
          cid: "A00VISIBLE1",
          title: "Synthetic visible item",
          state: "purchased",
          imageUrl: "https://images.example.com/visible.jpg",
          productUrl: "https://ebookjapan.yahoo.co.jp/books/100001/A00VISIBLE1/",
        },
      ]);
      assert.equal(reply.nextPageUrl, PAGE_2, state);
    }
  });

  it("prefers a visible free-history tab over a hidden purchased tab", () => {
    const doc = new MockDocument();
    const hiddenPurchasedShelf = addShell(doc, { activeTab: "purchased", amount: "1冊" });
    markShellInvisible(doc, hiddenPurchasedShelf, "aria-hidden");
    const visibleFreeShelf = addShell(doc, { activeTab: "free_history", amount: "1冊" });
    addItem(doc, visibleFreeShelf, {
      cid: "A00FREE0003",
      title: "Synthetic visible free history",
    });

    const reply = readEbookjapanLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.equal(reply.items[0]?.state, "free");
  });

  it("does not turn hidden purchased wording into an active purchased shelf or item title", () => {
    const doc = new MockDocument();
    const shelf = addShell(doc, { activeTab: "none", amount: "1冊" });
    const menu = doc.querySelector(".tab-menu-list");
    assert.ok(menu);
    const activeTab = el(doc, menu, "li", { className: "is-active" });
    el(doc, activeTab, "span", { text: "購入済み", attrs: { "aria-hidden": "true" } });
    const item = addItem(doc, shelf, {
      cid: "A00UNKNOWN1",
      title: "Synthetic visible title",
    });
    const anchor = item.querySelector("a");
    assert.ok(anchor);
    el(doc, anchor, "span", { text: "購入済み", attrs: { "aria-hidden": "true" } });

    assert.deepEqual(readEbookjapanLibraryPage(doc, PAGE_1), {
      ok: true,
      state: "page_not_ready",
      pageUrl: PAGE_1,
    });
  });

  it("keeps an item on the explicit free-history tab free when its purchased marker is hidden", () => {
    const doc = new MockDocument();
    const shelf = addShell(doc, { activeTab: "free_history", amount: "1冊" });
    const item = addItem(doc, shelf, {
      cid: "A00FREE0002",
      title: "Synthetic visible free title",
    });
    const anchor = item.querySelector("a");
    assert.ok(anchor);
    el(doc, anchor, "span", { text: "購入済み", attrs: { "aria-hidden": "true" } });

    const reply = readEbookjapanLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.deepEqual(reply.items, [
      {
        cid: "A00FREE0002",
        title: "Synthetic visible free title",
        state: "free",
        productUrl: "https://ebookjapan.yahoo.co.jp/books/100001/A00FREE0002/",
      },
    ]);
  });
});
