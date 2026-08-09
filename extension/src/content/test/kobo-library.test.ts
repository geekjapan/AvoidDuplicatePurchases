import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isKoboLibraryPageUrl,
  koboLibraryPageReader,
  readKoboLibraryPage,
} from "../kobo-library.js";
import { handleLibraryReadPage, registerLibraryPageReader } from "../library.js";
import { MockDocument, type MockElement } from "./mock-document.js";

const PAGE_1 = "https://books.rakuten.co.jp/e-book/kobo/library/";
const PAGE_2 = "https://books.rakuten.co.jp/e-book/kobo/library/page/2";
const OPAQUE_ID = "aa11bb22cc33dd44ee55ff6677889900";
const PRODUCT_HREF = `https://books.rakuten.co.jp/rk/${OPAQUE_ID}`;
const TITLE_HREF = `${PRODUCT_HREF}/?s=kobo_pc_mylibrary_purchased_book_title&xitem=redacted`;

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

type HiddenMode =
  | "hidden"
  | "aria-hidden"
  | "display-none"
  | "visibility-hidden"
  | "visibility-collapse"
  | "opacity-zero"
  | "computed-display-none";

function hideWith(node: MockElement, mode: HiddenMode): void {
  switch (mode) {
    case "hidden":
      node.hidden = true;
      break;
    case "aria-hidden":
      node.setAttribute("aria-hidden", "true");
      break;
    case "display-none":
      node.style.display = "none";
      break;
    case "visibility-hidden":
      node.style.visibility = "hidden";
      break;
    case "visibility-collapse":
      node.style.visibility = "collapse";
      break;
    case "opacity-zero":
      node.style.opacity = "0";
      break;
    case "computed-display-none":
      node.computedDisplay = "none";
      break;
  }
}

function addShell(
  doc: MockDocument,
  opts: {
    heading?: string;
    activeView?: "purchased" | "sample" | "none";
    purchasedCount?: string;
    sampleCount?: string;
    empty?: boolean;
  } = {},
): MockElement {
  el(doc, doc.body, "h1", {
    text: opts.heading ?? "マイライブラリ",
  });
  const nav = el(doc, doc.body, "ul", { className: "library-view-tabs" });
  const active = opts.activeView ?? "purchased";
  el(doc, nav, "li", {
    className: active === "purchased" ? "is-active" : "",
    text: `追加した書籍 ${opts.purchasedCount ?? "1"}`,
  });
  el(doc, nav, "li", {
    className: active === "sample" ? "is-active" : "",
    text: `立ち読み版 ${opts.sampleCount ?? "0"}`,
  });
  const list = el(doc, doc.body, "ul", { className: "rb-item-list" });
  if (opts.empty) {
    el(doc, doc.body, "div", {
      className: "empty-message",
      text: "追加した書籍 0件",
    });
  }
  return list;
}

function addItem(
  doc: MockDocument,
  list: MockElement,
  opts: {
    cid?: string;
    title?: string;
    href?: string | null;
    author?: string;
    seriesText?: string;
    seriesHref?: string;
    imgSrc?: string;
    badge?: string;
    downloadHref?: string;
    synced?: boolean;
  } = {},
): MockElement {
  const cid = opts.cid ?? OPAQUE_ID;
  const li = el(doc, list, "li");
  const wrapper = el(doc, li, "div", {
    className:
      opts.synced === false ? "rb-item-wrapper" : "rb-item-wrapper synced",
  });
  const imageWrap = el(doc, wrapper, "div", { className: "image" });
  if (opts.imgSrc !== undefined) {
    el(doc, imageWrap, "img", { attrs: { src: opts.imgSrc, alt: "" } });
  }
  const info = el(doc, wrapper, "div", { className: "rb-information-wrapper" });
  const titleWrap = el(doc, info, "div", { className: "title" });
  const heading = el(doc, titleWrap, "h1");
  if (opts.href !== null) {
    const href =
      opts.href ??
      `https://books.rakuten.co.jp/rk/${cid}/?s=kobo_pc_mylibrary_purchased_book_title`;
    const title = opts.title ?? "Synthetic redacted title";
    const anchorText = opts.badge ? `${title} ${opts.badge}` : title;
    el(doc, heading, "a", { href, text: anchorText });
  } else if (opts.title) {
    el(doc, heading, "span", { text: opts.title });
  }
  if (opts.author !== undefined) {
    el(doc, info, "div", { className: "author", text: opts.author });
  }
  if (opts.seriesText !== undefined) {
    el(doc, info, "a", {
      href:
        opts.seriesHref ??
        `https://books.rakuten.co.jp/e-book/search/?s=kobo_pc_mylibrary_purchased_book_series&q=redacted`,
      text: opts.seriesText,
    });
  }
  if (opts.downloadHref) {
    el(doc, wrapper, "a", {
      href: opts.downloadHref,
      text: "Download",
    });
  }
  return li;
}

describe("kobo library reader (DOM library-sync protocol)", () => {
  it("registers with the foundation registry under source kobo", () => {
    assert.equal(koboLibraryPageReader.source, "kobo");
    const unregister = registerLibraryPageReader(koboLibraryPageReader);
    try {
      const doc = new MockDocument();
      const list = addShell(doc);
      addItem(doc, list);
      const reply = handleLibraryReadPage("kobo", doc, PAGE_1);
      assert.equal(reply.ok, true);
      if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
      assert.deepEqual(reply.items, [
        {
          cid: OPAQUE_ID,
          title: "Synthetic redacted title",
          state: "purchased",
          productUrl: PRODUCT_HREF,
        },
      ]);
      assert.equal(reply.pageUrl, PAGE_1);
    } finally {
      unregister();
    }
  });

  it("accepts only the HTTPS books.rakuten.co.jp library path and /page/<positive>", () => {
    const valid = [
      PAGE_1,
      "https://books.rakuten.co.jp/e-book/kobo/library",
      PAGE_2,
      "https://books.rakuten.co.jp/e-book/kobo/library/page/34",
      "https://books.rakuten.co.jp/e-book/kobo/library/page/2/",
      // Temporary auth/tracking query and hash values are recognized on the
      // visible library path; readers normalize them away before replying.
      `${PAGE_1}?code=REDACTED_AUTH_CODE`,
      `${PAGE_1}?code=REDACTED_AUTH_CODE&ref=tracking#frag`,
      `${PAGE_2}?code=REDACTED#shelf`,
    ];
    for (const url of valid) assert.equal(isKoboLibraryPageUrl(url), true, url);

    const invalid = [
      "http://books.rakuten.co.jp/e-book/kobo/library/",
      "https://books.rakuten.com/e-book/kobo/library/",
      "https://books.rakuten.co.jp/e-book/mylibrary/",
      "https://books.rakuten.co.jp/rk/aa11bb22cc33dd44ee55ff6677889900/",
      "https://books.rakuten.co.jp/e-book/kobo/library/page/0",
      "https://books.rakuten.co.jp/e-book/kobo/library/page/-1",
      "https://books.rakuten.co.jp/e-book/kobo/library/page/abc",
      "https://user:pw@books.rakuten.co.jp/e-book/kobo/library/",
      "https://books.rakuten.co.jp:8443/e-book/kobo/library/",
      "https://books.rakuten.co.jp/e-book/kobo/library-old/?code=REDACTED",
    ];
    for (const url of invalid) assert.equal(isKoboLibraryPageUrl(url), false, url);
  });

  it("classifies login / not-found paths as login", () => {
    const doc = new MockDocument();
    addShell(doc, { empty: true });
    for (const url of [
      "https://books.rakuten.co.jp/e-book/mylibrary/",
      "https://books.rakuten.co.jp/",
      "https://login.account.rakuten.com/",
    ]) {
      assert.deepEqual(readKoboLibraryPage(doc, url), {
        ok: true,
        state: "login",
        pageUrl: url,
      });
    }
  });

  it("reports page_not_ready while the マイライブラリ shell is still missing", () => {
    const doc = new MockDocument();
    assert.deepEqual(readKoboLibraryPage(doc, PAGE_1), {
      ok: true,
      state: "page_not_ready",
      pageUrl: PAGE_1,
    });
  });

  it("reports an empty purchased view from the observed empty marker", () => {
    const doc = new MockDocument();
    addShell(doc, { empty: true, purchasedCount: "0" });
    assert.deepEqual(readKoboLibraryPage(doc, PAGE_1), {
      ok: true,
      state: "empty",
      pageUrl: PAGE_1,
      items: [],
      nextPageUrl: null,
    });
  });

  it("maps the selected 追加した書籍 view to purchased with title/author/series/image", () => {
    const doc = new MockDocument();
    const list = addShell(doc, { activeView: "purchased" });
    addItem(doc, list, {
      title: "Synthetic owned candidate",
      author: "Synthetic Author",
      seriesText: "Synthetic Series",
      imgSrc: "https://thumbnail.image.rakuten.co.jp/@0_redacted.jpg",
    });
    const reply = readKoboLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.deepEqual(reply.items, [
      {
        cid: OPAQUE_ID,
        title: "Synthetic owned candidate",
        state: "purchased",
        maker: "Synthetic Author",
        seriesId: "Synthetic Series",
        imageUrl: "https://thumbnail.image.rakuten.co.jp/@0_redacted.jpg",
        productUrl: PRODUCT_HREF,
      },
    ]);
    assert.equal(reply.nextPageUrl, null);
  });

  it("never merges the 立ち読み版 view into purchased", () => {
    const doc = new MockDocument();
    const list = addShell(doc, { activeView: "sample", sampleCount: "1" });
    addItem(doc, list, {
      cid: "bb22cc33dd44ee55ff6677889900aa11",
      title: "Synthetic preview title",
      href: "https://books.rakuten.co.jp/rk/bb22cc33dd44ee55ff6677889900aa11/",
    });
    const reply = readKoboLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.deepEqual(reply.items, [
      {
        cid: "bb22cc33dd44ee55ff6677889900aa11",
        title: "Synthetic preview title",
        state: "sample",
        productUrl:
          "https://books.rakuten.co.jp/rk/bb22cc33dd44ee55ff6677889900aa11",
      },
    ]);
  });

  it("keeps preview/sample/free/Kobo Plus/reservation/period-limited markers non-purchased", () => {
    const doc = new MockDocument();
    const list = addShell(doc, { purchasedCount: "7" });
    addItem(doc, list, {
      cid: "preview00000000000000000000000001",
      title: "Synthetic",
      badge: "プレビュー",
    });
    addItem(doc, list, {
      cid: "preven0000000000000000000000000001",
      title: "Synthetic",
      badge: "preview",
    });
    addItem(doc, list, {
      cid: "sample00000000000000000000000001",
      title: "Synthetic",
      badge: "立ち読み",
    });
    addItem(doc, list, {
      cid: "free0000000000000000000000000001",
      title: "Synthetic",
      badge: "無料",
    });
    addItem(doc, list, {
      cid: "plus0000000000000000000000000001",
      title: "Synthetic",
      badge: "Kobo Plus",
    });
    addItem(doc, list, {
      cid: "reserv00000000000000000000000001",
      title: "Synthetic",
      badge: "予約",
    });
    addItem(doc, list, {
      cid: "limited0000000000000000000000001",
      title: "Synthetic",
      badge: "期間限定",
    });
    const reply = readKoboLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.deepEqual(
      reply.items.map((item) => [item.cid, item.state]),
      [
        ["preview00000000000000000000000001", "preview"],
        ["preven0000000000000000000000000001", "preview"],
        ["sample00000000000000000000000001", "sample"],
        ["free0000000000000000000000000001", "free"],
        ["plus0000000000000000000000000001", "subscription"],
        ["reserv00000000000000000000000001", "reservation"],
        ["limited0000000000000000000000001", "unknown"],
      ],
    );
  });

  it("separates explicit プレビュー/preview into preview and 試し読み/サンプル/trial into sample", () => {
    const doc = new MockDocument();
    const list = addShell(doc, { purchasedCount: "6" });
    addItem(doc, list, {
      cid: "prevjap000000000000000000000000001",
      title: "Synthetic",
      badge: "プレビュー",
    });
    addItem(doc, list, {
      cid: "preven0000000000000000000000000001",
      title: "Synthetic",
      badge: "preview",
    });
    addItem(doc, list, {
      cid: "tachiyo000000000000000000000000001",
      title: "Synthetic",
      badge: "立ち読み",
    });
    addItem(doc, list, {
      cid: "tameshi000000000000000000000000001",
      title: "Synthetic",
      badge: "試し読み",
    });
    addItem(doc, list, {
      cid: "sampjap000000000000000000000000001",
      title: "Synthetic",
      badge: "サンプル",
    });
    addItem(doc, list, {
      cid: "trial00000000000000000000000000001",
      title: "Synthetic",
      badge: "trial",
    });
    const reply = readKoboLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.deepEqual(
      reply.items.map((item) => [item.cid, item.state]),
      [
        ["prevjap000000000000000000000000001", "preview"],
        ["preven0000000000000000000000000001", "preview"],
        ["tachiyo000000000000000000000000001", "sample"],
        ["tameshi000000000000000000000000001", "sample"],
        ["sampjap000000000000000000000000001", "sample"],
        ["trial00000000000000000000000000001", "sample"],
      ],
    );
  });

  it("passes preview and sample through the foundation registry verbatim", () => {
    const unregister = registerLibraryPageReader(koboLibraryPageReader);
    try {
      const doc = new MockDocument();
      const list = addShell(doc, { purchasedCount: "2" });
      addItem(doc, list, {
        cid: "preview00000000000000000000000002",
        title: "Synthetic",
        badge: "プレビュー",
      });
      addItem(doc, list, {
        cid: "sample00000000000000000000000002",
        title: "Synthetic",
        badge: "サンプル",
      });
      const reply = handleLibraryReadPage("kobo", doc, PAGE_1);
      assert.equal(reply.ok, true);
      if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
      // The local import contract receives each state independently.
      assert.deepEqual(
        reply.items.map((item) => [item.cid, item.state]),
        [
          ["preview00000000000000000000000002", "preview"],
          ["sample00000000000000000000000002", "sample"],
        ],
      );
    } finally {
      unregister();
    }
  });

  it("ignores download/Adobe DRM links and only uses the title product link", () => {
    const doc = new MockDocument();
    const list = addShell(doc);
    addItem(doc, list, {
      title: "Keep title link",
      downloadHref:
        "https://books.rakuten.co.jp/e-book/download/adobe?token=REDACTED",
    });
    // DRM-only row with no title product link must not invent a product.
    const li = el(doc, list, "li");
    const wrapper = el(doc, li, "div", { className: "rb-item-wrapper synced" });
    const info = el(doc, wrapper, "div", { className: "rb-information-wrapper" });
    const titleWrap = el(doc, info, "div", { className: "title" });
    const heading = el(doc, titleWrap, "h1");
    el(doc, heading, "a", {
      href: "https://books.rakuten.co.jp/e-book/download/acs?token=REDACTED",
      text: "Adobe DRM download",
    });
    const reply = readKoboLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.deepEqual(reply.items, [
      {
        cid: OPAQUE_ID,
        title: "Keep title link",
        state: "purchased",
        productUrl: PRODUCT_HREF,
      },
    ]);
  });

  it("accepts temporary auth query values and normalizes every emitted page URL", () => {
    const doc = new MockDocument();
    const list = addShell(doc);
    addItem(doc, list, {
      href: TITLE_HREF,
    });
    el(doc, doc.body, "a", {
      href: "/e-book/kobo/library/page/2",
      text: "次の30件 »",
    });
    const unsafe = `${PAGE_1}?code=REDACTED_AUTH_CODE&ref=tracking#frag`;
    const reply = readKoboLibraryPage(doc, unsafe);
    // The visible page is read normally; query/hash never leak into the
    // returned page URL, items, or the next-page target.
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.equal(reply.pageUrl, PAGE_1);
    assert.equal(reply.items.length, 1);
    assert.equal(reply.items[0]?.productUrl, PRODUCT_HREF);
    assert.equal(reply.nextPageUrl, PAGE_2);
    assert.equal(reply.pageUrl.includes("?"), false);
    assert.equal(reply.pageUrl.includes("code="), false);
    assert.equal(reply.nextPageUrl?.includes("code="), false);

    // A query-carrying visible next control is never followed: the reply
    // emits no next URL rather than retaining the query.
    const withQueryPager = new MockDocument();
    const list2 = addShell(withQueryPager);
    addItem(withQueryPager, list2);
    el(withQueryPager, withQueryPager.body, "a", {
      href: "/e-book/kobo/library/page/2?code=REDACTED",
      text: "次の30件 »",
    });
    const normalized = readKoboLibraryPage(withQueryPager, `${PAGE_1}?code=REDACTED`);
    assert.equal(normalized.ok, true);
    if (!normalized.ok || normalized.state !== "ready") throw new Error("expected ready");
    assert.equal(normalized.pageUrl, PAGE_1);
    assert.equal(normalized.nextPageUrl, null);
  });

  it("preserves absolute http(s) images without credentials only", () => {
    const doc = new MockDocument();
    const list = addShell(doc, { purchasedCount: "4" });
    addItem(doc, list, {
      cid: "img00000000000000000000000000001",
      imgSrc: "https://thumbnail.image.rakuten.co.jp/@0_redacted.jpg",
    });
    addItem(doc, list, {
      cid: "img00000000000000000000000000002",
      imgSrc: "http://images.example.com/redacted.jpg",
    });
    addItem(doc, list, {
      cid: "img00000000000000000000000000003",
      imgSrc: "/images/relative.jpg",
    });
    addItem(doc, list, {
      cid: "img00000000000000000000000000004",
      imgSrc: "https://user:pw@images.example.com/redacted.jpg",
    });
    const reply = readKoboLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.deepEqual(
      reply.items.map((item) => item.imageUrl ?? null),
      [
        "https://thumbnail.image.rakuten.co.jp/@0_redacted.jpg",
        "http://images.example.com/redacted.jpg",
        null,
        null,
      ],
    );
  });

  it("dedupes duplicate title rows and never invents product URLs", () => {
    const doc = new MockDocument();
    const list = addShell(doc, { purchasedCount: "3" });
    addItem(doc, list, {
      cid: "keep0000000000000000000000000001",
      title: "Keep",
      href: "https://books.rakuten.co.jp/rk/keep0000000000000000000000000001/?ref=a",
    });
    addItem(doc, list, {
      cid: "keep0000000000000000000000000001",
      title: "Duplicate",
      href: "https://books.rakuten.co.jp/rk/keep0000000000000000000000000001/?ref=b",
    });
    addItem(doc, list, {
      cid: "nolink00000000000000000000000001",
      title: "No link",
      href: null,
    });
    addItem(doc, list, {
      cid: "creds000000000000000000000000001",
      title: "Creds",
      href: "https://user:pw@books.rakuten.co.jp/rk/creds000000000000000000000000001/",
    });
    const reply = readKoboLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.deepEqual(reply.items, [
      {
        cid: "keep0000000000000000000000000001",
        title: "Keep",
        state: "purchased",
        productUrl:
          "https://books.rakuten.co.jp/rk/keep0000000000000000000000000001",
      },
    ]);
  });

  it("drives a bounded next URL from the visible 次の30件 control", () => {
    const doc = new MockDocument();
    const list = addShell(doc, { purchasedCount: "30" });
    addItem(doc, list);
    el(doc, doc.body, "a", {
      href: "/e-book/kobo/library/page/2",
      text: "次の30件 »",
    });
    const reply = readKoboLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.equal(reply.pageUrl, PAGE_1);
    assert.equal(reply.nextPageUrl, PAGE_2);
  });

  it("emits no next URL when no later visible library control exists", () => {
    const doc = new MockDocument();
    const list = addShell(doc);
    addItem(doc, list);
    el(doc, doc.body, "a", {
      href: "https://evil.example.com/e-book/kobo/library/page/2",
      text: "次の30件 »",
    });
    el(doc, doc.body, "a", {
      href: "/e-book/kobo/library/page/1",
      text: "1",
    });
    const reply = readKoboLibraryPage(doc, PAGE_2);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.equal(reply.pageUrl, PAGE_2);
    assert.equal(reply.nextPageUrl, null);
  });

  it("fails closed as page_not_ready when the view selection is ambiguous", () => {
    const doc = new MockDocument();
    addShell(doc, { activeView: "none", purchasedCount: "1" });
    // No purchased_book_title marker and no active tab → unknown view.
    const list = doc.body.querySelector(".rb-item-list");
    assert.ok(list);
    addItem(doc, list, {
      href: "https://books.rakuten.co.jp/rk/aa11bb22cc33dd44ee55ff6677889900/",
      title: "Ambiguous",
    });
    assert.deepEqual(readKoboLibraryPage(doc, PAGE_1), {
      ok: true,
      state: "page_not_ready",
      pageUrl: PAGE_1,
    });
  });

  it("uses visible shell/view/empty evidence when hidden duplicates exist", () => {
    const doc = new MockDocument();
    const hiddenHeading = el(doc, doc.body, "h1", {
      text: "マイライブラリ",
    });
    hideWith(hiddenHeading, "aria-hidden");
    const list = addShell(doc, { activeView: "purchased" });
    const nav = doc.body.querySelector(".library-view-tabs");
    assert.ok(nav);
    const hiddenSample = el(doc, nav, "li", {
      className: "is-active",
      text: "立ち読み版 9",
    });
    hideWith(hiddenSample, "hidden");
    const hiddenEmpty = el(doc, doc.body, "div", {
      className: "empty-message",
      text: "追加した書籍 0件",
    });
    hideWith(hiddenEmpty, "display-none");
    addItem(doc, list, { title: "Visible item" });

    const reply = readKoboLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.equal(reply.items[0]?.state, "purchased");

    const hiddenOnly = new MockDocument();
    const hiddenOnlyHeading = el(hiddenOnly, hiddenOnly.body, "h1", {
      text: "マイライブラリ",
    });
    hideWith(hiddenOnlyHeading, "visibility-hidden");
    assert.deepEqual(readKoboLibraryPage(hiddenOnly, PAGE_1), {
      ok: true,
      state: "page_not_ready",
      pageUrl: PAGE_1,
    });
  });

  it("ignores active controls hidden by every supported visibility state", () => {
    const modes: HiddenMode[] = [
      "hidden",
      "aria-hidden",
      "display-none",
      "visibility-hidden",
      "visibility-collapse",
      "opacity-zero",
      "computed-display-none",
    ];

    for (const mode of modes) {
      const doc = new MockDocument();
      const list = addShell(doc, { activeView: "purchased" });
      const nav = doc.body.querySelector(".library-view-tabs");
      assert.ok(nav);
      const hiddenSample = el(doc, nav, "li", {
        className: "is-active",
        text: "立ち読み版 1",
      });
      hideWith(hiddenSample, mode);
      addItem(doc, list, { title: "Visible purchased item" });

      const reply = readKoboLibraryPage(doc, PAGE_1);
      assert.equal(reply.ok, true, mode);
      if (!reply.ok || reply.state !== "ready") throw new Error(`expected ready: ${mode}`);
      assert.equal(reply.items[0]?.state, "purchased", mode);
    }

    const ancestorHidden = new MockDocument();
    const list = addShell(ancestorHidden, { activeView: "purchased" });
    const nav = ancestorHidden.body.querySelector(".library-view-tabs");
    assert.ok(nav);
    const hiddenAncestor = el(ancestorHidden, nav, "div");
    el(ancestorHidden, hiddenAncestor, "li", {
      className: "is-active",
      text: "立ち読み版 1",
    });
    hideWith(hiddenAncestor, "aria-hidden");
    addItem(ancestorHidden, list, { title: "Visible purchased item" });

    const reply = readKoboLibraryPage(ancestorHidden, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.equal(reply.items[0]?.state, "purchased");
  });

  it("uses visible item fields and ignores hidden wrappers, links, media, and markers", () => {
    const doc = new MockDocument();
    const list = addShell(doc, { activeView: "purchased" });
    const hiddenItem = addItem(doc, list, {
      cid: "hidden00000000000000000000000001",
      title: "Hidden item",
    });
    hideWith(hiddenItem, "display-none");

    const visibleItem = addItem(doc, list, {
      cid: "visible00000000000000000000000001",
      title: "Visible title",
      author: "Visible author",
      seriesText: "Visible series",
      imgSrc: "https://images.example.com/visible.jpg",
    });
    const wrapper = visibleItem.querySelector(".rb-item-wrapper");
    assert.ok(wrapper);
    const info = wrapper.querySelector(".rb-information-wrapper");
    const titleHeading = wrapper.querySelector(".title")?.querySelector("h1");
    const image = wrapper.querySelector(".image");
    assert.ok(info);
    assert.ok(titleHeading);
    assert.ok(image);

    const hiddenTitle = doc.createElement("a");
    hiddenTitle.setAttribute(
      "href",
      "https://books.rakuten.co.jp/rk/hidden-title-00000000000000000000000001",
    );
    hiddenTitle.textContent = "Hidden title";
    titleHeading.insertAdjacentElement("afterbegin", hiddenTitle);
    hideWith(hiddenTitle, "aria-hidden");

    const hiddenImage = doc.createElement("img");
    hiddenImage.setAttribute("src", "https://images.example.com/hidden.jpg");
    image.insertAdjacentElement("afterbegin", hiddenImage);
    hideWith(hiddenImage, "visibility-hidden");

    const hiddenAuthor = el(doc, info, "div", {
      className: "author",
      text: "Hidden author",
    });
    info.insertAdjacentElement("afterbegin", hiddenAuthor);
    hideWith(hiddenAuthor, "visibility-collapse");

    const hiddenSeries = doc.createElement("a");
    hiddenSeries.setAttribute(
      "href",
      "https://books.rakuten.co.jp/e-book/search/?s=kobo_pc_mylibrary_purchased_book_series",
    );
    hiddenSeries.textContent = "Hidden series";
    info.insertAdjacentElement("afterbegin", hiddenSeries);
    hideWith(hiddenSeries, "opacity-zero");

    const hiddenMarker = el(doc, wrapper, "span", {
      text: "無料 購入済み",
    });
    hideWith(hiddenMarker, "computed-display-none");

    const reply = readKoboLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.deepEqual(reply.items, [
      {
        cid: "visible00000000000000000000000001",
        title: "Visible title",
        state: "purchased",
        maker: "Visible author",
        seriesId: "Visible series",
        imageUrl: "https://images.example.com/visible.jpg",
        productUrl:
          "https://books.rakuten.co.jp/rk/visible00000000000000000000000001",
      },
    ]);
  });

  it("does not use hidden purchased markers or pagination links", () => {
    const ambiguous = new MockDocument();
    const list = addShell(ambiguous, { activeView: "none" });
    addItem(ambiguous, list, {
      href: PRODUCT_HREF,
      title: "Visible title without purchased marker",
    });
    const hiddenPurchasedMarker = el(ambiguous, ambiguous.body, "a", {
      href: TITLE_HREF,
      text: "Hidden purchased title",
    });
    hideWith(hiddenPurchasedMarker, "hidden");
    assert.deepEqual(readKoboLibraryPage(ambiguous, PAGE_1), {
      ok: true,
      state: "page_not_ready",
      pageUrl: PAGE_1,
    });

    const doc = new MockDocument();
    const listWithPager = addShell(doc, { activeView: "purchased" });
    addItem(doc, listWithPager);
    const hiddenPage = el(doc, doc.body, "a", {
      href: "/e-book/kobo/library/page/2",
      text: "次の30件",
    });
    hideWith(hiddenPage, "aria-hidden");
    el(doc, doc.body, "a", {
      href: "/e-book/kobo/library/page/3",
      text: "次の30件",
    });

    const reply = readKoboLibraryPage(doc, PAGE_1);
    assert.equal(reply.ok, true);
    if (!reply.ok || reply.state !== "ready") throw new Error("expected ready");
    assert.equal(
      reply.nextPageUrl,
      "https://books.rakuten.co.jp/e-book/kobo/library/page/3",
    );
  });
});
