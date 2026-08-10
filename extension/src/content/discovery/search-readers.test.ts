import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockDocument, type MockElement } from "../test/mock-document.js";
import { readDiscoverySearchPage } from "./search-readers.js";

function dlsiteSearchDoc(): MockDocument {
  const doc = new MockDocument();
  doc.title = "フォレスティア の検索結果 | DLsite";
  const list = doc.createElement("div");
  list.className = "n_worklist";

  const addItem = (
    cid: string,
    title: string,
    maker: string,
    href: string,
  ): void => {
    const li = doc.createElement("li");
    li.className = "search_result_img_box_inner";
    li.setAttribute("data-list_item_product_id", cid);

    const workDd = doc.createElement("dd");
    workDd.className = "work_name";
    const workA = doc.createElement("a") as MockElement;
    workA.href = href;
    workA.setAttribute("href", href);
    workA.setAttribute("title", title);
    workA.textContent = title;
    workDd.appendChild(workA);

    const makerDd = doc.createElement("dd");
    makerDd.className = "maker_name";
    const makerA = doc.createElement("a");
    makerA.textContent = maker;
    makerDd.appendChild(makerA);

    const thumb = doc.createElement("a") as MockElement;
    thumb.href = href;
    thumb.setAttribute("href", href);
    thumb.textContent = "thumb";

    li.appendChild(workDd);
    li.appendChild(makerDd);
    li.appendChild(thumb);
    list.appendChild(li);
  };

  addItem(
    "RJ012345",
    "フォレスティア",
    "サークル森",
    "https://www.dlsite.com/maniax/work/=/product_id/RJ012345.html",
  );
  addItem(
    "RJ012346",
    "フォレスティア 別版",
    "別サークル",
    "https://www.dlsite.com/maniax/work/=/product_id/RJ012346.html",
  );
  // cart URL must be rejected
  addItem(
    "RJ999999",
    "カート混入",
    "偽",
    "https://www.dlsite.com/maniax/cart/=/product_id/RJ999999.html",
  );
  // non-maniax floors must be rejected (wave-1 content_scripts = maniax only)
  addItem(
    "RJ012347",
    "プロフロア",
    "他",
    "https://www.dlsite.com/pro/work/=/product_id/RJ012347.html",
  );
  addItem(
    "RJ012348",
    "ブックスフロア",
    "他",
    "https://www.dlsite.com/books/work/=/product_id/RJ012348.html",
  );
  // duplicate CID
  addItem(
    "RJ012345",
    "フォレスティア dup",
    "サークル森",
    "https://www.dlsite.com/maniax/work/=/product_id/RJ012345.html",
  );

  doc.body.appendChild(list);
  return doc;
}

/**
 * Modern / attribute-diff DLsite search DOM:
 * - no `search_result_img_box_inner` / `data-list_item_product_id`
 * - cards identified by structure (article) + canonical maniax product links
 * - page-level product links outside result cards must not become candidates
 */
function dlsiteModernSearchDoc(): MockDocument {
  const doc = new MockDocument();
  doc.title = "フォレスティア の検索結果 | DLsite";

  // Page-wide navigation / recommend link — must NOT be a candidate.
  const nav = doc.createElement("nav");
  const navA = doc.createElement("a") as MockElement;
  navA.href =
    "https://www.dlsite.com/maniax/work/=/product_id/RJ999888.html";
  navA.setAttribute(
    "href",
    "https://www.dlsite.com/maniax/work/=/product_id/RJ999888.html",
  );
  navA.textContent = "おすすめ作品";
  nav.appendChild(navA);
  doc.body.appendChild(nav);

  const results = doc.createElement("div");
  results.className = "search_work_list_modern";

  const addCard = (
    cid: string,
    title: string,
    maker: string,
    href: string,
    circleHref: string,
  ): void => {
    const card = doc.createElement("article");
    // Deliberately omit legacy classes and data-list_item_product_id.

    const thumb = doc.createElement("a") as MockElement;
    thumb.href = href;
    thumb.setAttribute("href", href);
    const img = doc.createElement("img");
    img.setAttribute("alt", title);
    thumb.appendChild(img);

    const titleWrap = doc.createElement("div");
    const titleA = doc.createElement("a") as MockElement;
    titleA.href = href;
    titleA.setAttribute("href", href);
    titleA.textContent = title;
    titleWrap.appendChild(titleA);

    const makerWrap = doc.createElement("div");
    const makerA = doc.createElement("a") as MockElement;
    makerA.href = circleHref;
    makerA.setAttribute("href", circleHref);
    makerA.textContent = maker;
    makerWrap.appendChild(makerA);

    card.appendChild(thumb);
    card.appendChild(titleWrap);
    card.appendChild(makerWrap);
    results.appendChild(card);
  };

  addCard(
    "RJ01221027",
    "フォレスティア",
    "サークル森",
    "https://www.dlsite.com/maniax/work/=/product_id/RJ01221027.html",
    "https://www.dlsite.com/maniax/circle/profile/=/maker_id/RG00001.html",
  );
  addCard(
    "RJ01221028",
    "フォレスティア 別版",
    "別サークル",
    "https://www.dlsite.com/maniax/work/=/product_id/RJ01221028.html",
    "https://www.dlsite.com/maniax/circle/profile/=/maker_id/RG00002.html",
  );
  // Non-maniax floor product link inside a card must be rejected.
  addCard(
    "RJ01221029",
    "プロフロア",
    "他",
    "https://www.dlsite.com/pro/work/=/product_id/RJ01221029.html",
    "https://www.dlsite.com/pro/circle/profile/=/maker_id/RG00003.html",
  );
  // Card with product link but no maker text → fail-closed drop.
  const noMaker = doc.createElement("article");
  const noMakerA = doc.createElement("a") as MockElement;
  noMakerA.href =
    "https://www.dlsite.com/maniax/work/=/product_id/RJ01221030.html";
  noMakerA.setAttribute(
    "href",
    "https://www.dlsite.com/maniax/work/=/product_id/RJ01221030.html",
  );
  noMakerA.textContent = "メーカー欠落";
  noMaker.appendChild(noMakerA);
  results.appendChild(noMaker);

  doc.body.appendChild(results);
  return doc;
}

/**
 * Chrome regions (nav/header/footer/aside) that wrap product links in ul>li.
 * These must not become search candidates even with title + maker present.
 */
function dlsiteChromeListProductDoc(chromeTag: "nav" | "header" | "footer" | "aside"): MockDocument {
  const doc = new MockDocument();
  doc.title = "フォレスティア の検索結果 | DLsite";

  const chrome = doc.createElement(chromeTag);
  const ul = doc.createElement("ul");
  const li = doc.createElement("li");

  const productHref =
    chromeTag === "nav"
      ? "https://www.dlsite.com/maniax/work/=/product_id/RJ999777.html"
      : chromeTag === "footer"
        ? "https://www.dlsite.com/maniax/work/=/product_id/RJ999666.html"
        : chromeTag === "header"
          ? "https://www.dlsite.com/maniax/work/=/product_id/RJ999555.html"
          : "https://www.dlsite.com/maniax/work/=/product_id/RJ999444.html";

  const productA = doc.createElement("a") as MockElement;
  productA.href = productHref;
  productA.setAttribute("href", productHref);
  productA.textContent = "クロム作品";

  const makerA = doc.createElement("a") as MockElement;
  makerA.href = "https://www.dlsite.com/maniax/circle/profile/=/maker_id/RG99999.html";
  makerA.setAttribute(
    "href",
    "https://www.dlsite.com/maniax/circle/profile/=/maker_id/RG99999.html",
  );
  makerA.textContent = "クロムサークル";

  li.appendChild(productA);
  li.appendChild(makerA);
  ul.appendChild(li);
  chrome.appendChild(ul);
  doc.body.appendChild(chrome);
  return doc;
}

/** Search URL page with only chrome list items (no product links, no results shell). */
function dlsiteNavListOnlySearchDoc(): MockDocument {
  const doc = new MockDocument();
  doc.title = "検索中 | DLsite";
  const nav = doc.createElement("nav");
  const ul = doc.createElement("ul");
  const li = doc.createElement("li");
  const home = doc.createElement("a") as MockElement;
  home.href = "https://www.dlsite.com/maniax/";
  home.setAttribute("href", "https://www.dlsite.com/maniax/");
  home.textContent = "ホーム";
  li.appendChild(home);
  ul.appendChild(li);
  nav.appendChild(ul);
  doc.body.appendChild(nav);
  return doc;
}

/**
 * Live DLsite list view (show_type=1/2) — the failing live-like shape:
 * - table.work_1col_table.n_worklist > tr[data-list_item_product_id] (class often empty/space)
 * - title under dt.work_name > a (not dd.work_name)
 * - cart/wishlist links inside the same row must not create multi-product cards
 * - no li.search_result_img_box_inner
 *
 * Before the work_1col fix this returned state "empty" (shell present, 0 candidates)
 * → background discovery_no_match for FANZA-origin → DLsite-search.
 */
function dlsiteWork1ColLiveSearchDoc(): MockDocument {
  const doc = new MockDocument();
  doc.title = "検索結果 | DLsite";
  const table = doc.createElement("table");
  table.className = "work_1col_table n_worklist";

  const addRow = (
    cid: string,
    title: string,
    maker: string,
    href: string,
    circleHref: string,
  ): void => {
    const tr = doc.createElement("tr");
    // Live markup: class is often a single space, not search_result_img_box_inner.
    tr.className = " ";
    tr.setAttribute("data-list_item_product_id", cid);

    const tdThumb = doc.createElement("td");
    tdThumb.className = "work_1col_thumb";
    // Vue thumb component without a real product <a href>.

    const td = doc.createElement("td");
    const dl = doc.createElement("dl");
    dl.className = "work_1col";

    const dt = doc.createElement("dt");
    dt.className = "work_name";
    const titleA = doc.createElement("a") as MockElement;
    titleA.href = href;
    titleA.setAttribute("href", href);
    titleA.setAttribute("title", title);
    titleA.textContent = title;
    dt.appendChild(titleA);

    const makerDd = doc.createElement("dd");
    makerDd.className = "maker_name";
    const makerA = doc.createElement("a") as MockElement;
    makerA.href = circleHref;
    makerA.setAttribute("href", circleHref);
    makerA.textContent = maker;
    makerDd.appendChild(makerA);

    const cart = doc.createElement("a") as MockElement;
    cart.href = `https://www.dlsite.com/maniax/cart/=/product_id/${cid}.html`;
    cart.setAttribute("href", cart.href);
    cart.textContent = "カートに追加";

    const wish = doc.createElement("a") as MockElement;
    wish.href = `https://www.dlsite.com/maniax/mypage/wishlist/=/product_id/${cid}.html`;
    wish.setAttribute("href", wish.href);
    wish.textContent = "お気に入りに追加";

    dl.appendChild(dt);
    dl.appendChild(makerDd);
    td.appendChild(dl);
    td.appendChild(cart);
    td.appendChild(wish);
    tr.appendChild(tdThumb);
    tr.appendChild(td);
    table.appendChild(tr);
  };

  // Redacted live-like counterpart pair (FANZA d_781951 class): long campaign title + circle.
  addRow(
    "RJ01652658",
    "【2周年記念110円/差分付き】 完堕ち義母とザコマン後輩",
    "ろまあぽ",
    "https://www.dlsite.com/maniax/work/=/product_id/RJ01652658.html",
    "https://www.dlsite.com/maniax/circle/profile/=/maker_id/RG48610.html",
  );
  addRow(
    "RJ012345",
    "別作品",
    "別サークル",
    "https://www.dlsite.com/maniax/work/=/product_id/RJ012345.html",
    "https://www.dlsite.com/maniax/circle/profile/=/maker_id/RG00002.html",
  );
  // Non-maniax floor row must stay rejected.
  addRow(
    "RJ012347",
    "プロフロア",
    "他",
    "https://www.dlsite.com/pro/work/=/product_id/RJ012347.html",
    "https://www.dlsite.com/pro/circle/profile/=/maker_id/RG00003.html",
  );

  doc.body.appendChild(table);
  return doc;
}

/**
 * Live FANZA search card shape: multi-author block under tileListTtl__txt--author
 * ("circle / creator 他"). DLsite-origin → FANZA-search must still emit the product
 * and prefer the circle (article=maker) for makerMatchKey alignment.
 */
function fanzaLiveMultiAuthorSearchDoc(): MockDocument {
  const doc = new MockDocument();
  doc.title = "検索結果 - FANZA同人";
  const ul = doc.createElement("ul");
  ul.className = "productList fn-productList";

  const li = doc.createElement("li");
  li.className = "productList__item";

  const href = "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_781951/";
  const productA = doc.createElement("a") as MockElement;
  productA.href = href;
  productA.setAttribute("href", href);
  const img = doc.createElement("img");
  img.setAttribute(
    "alt",
    "【2周年記念110円/差分付き】完堕ち義母とザコマン後輩",
  );
  productA.appendChild(img);

  const ttl = doc.createElement("div");
  ttl.className = "tileListTtl__txt";
  const ttlA = doc.createElement("a") as MockElement;
  ttlA.href = href;
  ttlA.setAttribute("href", href);
  ttlA.textContent = "【2周年記念110円/差分付き】完堕ち義母とザコマン後輩";
  ttl.appendChild(ttlA);

  const author = doc.createElement("div");
  author.className = "tileListTtl__txt--author";
  const circle = doc.createElement("a") as MockElement;
  circle.href = "https://www.dmm.co.jp/dc/doujin/-/list/=/article=maker/id=217051/";
  circle.setAttribute("href", circle.href);
  circle.textContent = "ろまあぽ";
  const sep = doc.createElement("span");
  sep.textContent = " / ";
  const creator = doc.createElement("a") as MockElement;
  creator.href =
    "https://www.dmm.co.jp/dc/doujin/-/list/=/article=creator/id=example/section=mens/";
  creator.setAttribute("href", creator.href);
  creator.textContent = "声優サンプル";
  const others = doc.createElement("span");
  others.textContent = "他";
  author.appendChild(circle);
  author.appendChild(sep);
  author.appendChild(creator);
  author.appendChild(others);

  // Non-target noise: basket-like path must stay rejected when mixed in list.
  const basketLi = doc.createElement("li");
  basketLi.className = "productList__item";
  const basketA = doc.createElement("a") as MockElement;
  basketA.href = "https://www.dmm.co.jp/dc/doujin/-/basket/=/cid=d_evil/";
  basketA.setAttribute("href", basketA.href);
  const basketTtl = doc.createElement("div");
  basketTtl.className = "tileListTtl__txt";
  basketTtl.textContent = "カート混入";
  basketLi.appendChild(basketA);
  basketLi.appendChild(basketTtl);

  li.appendChild(productA);
  li.appendChild(ttl);
  li.appendChild(author);
  ul.appendChild(li);
  ul.appendChild(basketLi);
  doc.body.appendChild(ul);
  return doc;
}

function fanzaSearchDoc(): MockDocument {
  const doc = new MockDocument();
  doc.title = "フォレスティア の検索結果 - FANZA同人";
  const ul = doc.createElement("ul");
  ul.className = "productList fn-productList";

  const addItem = (
    cid: string,
    title: string,
    maker: string | null,
    href: string,
  ): void => {
    const li = doc.createElement("li");
    li.className = "productList__item";

    const productA = doc.createElement("a") as MockElement;
    productA.href = href;
    productA.setAttribute("href", href);
    const img = doc.createElement("img");
    img.setAttribute("alt", title);
    productA.appendChild(img);

    const ttl = doc.createElement("div");
    ttl.className = "tileListTtl__txt";
    const ttlA = doc.createElement("a") as MockElement;
    ttlA.href = href;
    ttlA.setAttribute("href", href);
    ttlA.textContent = title;
    ttl.appendChild(ttlA);

    li.appendChild(productA);
    li.appendChild(ttl);

    if (maker !== null) {
      const author = doc.createElement("div");
      author.className = "tileListTtl__txt--author";
      const authorA = doc.createElement("a");
      authorA.textContent = maker;
      author.appendChild(authorA);
      li.appendChild(author);
    }

    ul.appendChild(li);
  };

  addItem(
    "d_123456",
    "フォレスティア",
    "サークル森",
    "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_123456/",
  );
  addItem(
    "d_123457",
    "フォレスティア 外伝",
    "別サークル",
    "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_123457/?i3_ref=list",
  );
  addItem(
    "d_evil",
    "evil title",
    "x",
    "https://evil.dmm.co.jp/dc/doujin/-/detail/=/cid=d_evil/",
  );
  addItem(
    "d_wish",
    "wish",
    null,
    "https://www.dmm.co.jp/dc/doujin/-/wishlist/=/cid=d_wish/",
  );

  doc.body.appendChild(ul);
  return doc;
}

function fanzaClasslessSearchDoc(): MockDocument {
  const doc = new MockDocument();
  doc.title = "検索結果 - FANZA同人";

  // Result card with no legacy productList classes. The canonical detail link
  // and list-item boundary are the stable signals that remain.
  const article = doc.createElement("article");
  const product = doc.createElement("a") as MockElement;
  const productUrl = "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_733274/";
  product.href = productUrl;
  product.setAttribute("href", productUrl);
  product.textContent = "クラス変更作品";

  const title = doc.createElement("h3");
  title.textContent = "クラス変更作品";

  const maker = doc.createElement("a") as MockElement;
  maker.href =
    "https://www.dmm.co.jp/dc/doujin/-/list/=/article=maker/id=42/";
  maker.setAttribute("href", maker.href);
  maker.textContent = "サークル森";

  article.appendChild(product);
  article.appendChild(title);
  article.appendChild(maker);
  doc.body.appendChild(article);
  return doc;
}

describe("discovery search readers", () => {
  it("reads DLsite search cards with cid/title/maker and dedupes CID", () => {
    const doc = dlsiteSearchDoc();
    const reply = readDiscoverySearchPage(
      "dlsite",
      doc as unknown as Document,
      "https://www.dlsite.com/maniax/fsr/=/keyword/test/",
    );
    assert.equal(reply.ok, true);
    if (!reply.ok) return;
    assert.equal(reply.state, "ready");
    if (reply.state !== "ready") return;
    assert.equal(reply.candidates.length, 2);
    assert.equal(reply.candidates[0]!.cid, "RJ012345");
    assert.equal(reply.candidates[0]!.title, "フォレスティア");
    assert.equal(reply.candidates[0]!.maker, "サークル森");
    assert.match(reply.candidates[0]!.productUrl, /RJ012345/);
    assert.equal(
      reply.candidates.some((c) => c.cid === "RJ999999"),
      false,
      "cart URL must be rejected",
    );
    assert.equal(
      reply.candidates.some((c) => c.cid === "RJ012347" || c.cid === "RJ012348"),
      false,
      "non-maniax DLsite floors must be rejected",
    );
  });

  it("reads modern DLsite result cards via canonical product URLs without legacy attrs", () => {
    const doc = dlsiteModernSearchDoc();
    const reply = readDiscoverySearchPage(
      "dlsite",
      doc as unknown as Document,
      "https://www.dlsite.com/maniax/fsr/=/keyword/test/",
    );
    assert.equal(reply.ok, true);
    if (!reply.ok) return;
    assert.equal(reply.state, "ready");
    if (reply.state !== "ready") return;
    assert.equal(reply.candidates.length, 2);
    assert.equal(reply.candidates[0]!.cid, "RJ01221027");
    assert.equal(reply.candidates[0]!.title, "フォレスティア");
    assert.equal(reply.candidates[0]!.maker, "サークル森");
    assert.equal(
      reply.candidates[0]!.productUrl,
      "https://www.dlsite.com/maniax/work/=/product_id/RJ01221027.html",
    );
    assert.equal(reply.candidates[1]!.cid, "RJ01221028");
    assert.equal(
      reply.candidates.some((c) => c.cid === "RJ999888"),
      false,
      "page-wide product links outside result cards must not be candidates",
    );
    assert.equal(
      reply.candidates.some((c) => c.cid === "RJ01221029"),
      false,
      "non-maniax floors must be rejected",
    );
    assert.equal(
      reply.candidates.some((c) => c.cid === "RJ01221030"),
      false,
      "cards without maker must fail closed",
    );
  });

  it("reads FANZA doujin productList cards and rejects lookalike hosts", () => {
    const doc = fanzaSearchDoc();
    const reply = readDiscoverySearchPage(
      "fanza_doujin",
      doc as unknown as Document,
      "https://www.dmm.co.jp/dc/doujin/-/list/narrow/=/word=test/",
    );
    assert.equal(reply.ok, true);
    if (!reply.ok) return;
    assert.equal(reply.state, "ready");
    if (reply.state !== "ready") return;
    assert.equal(reply.candidates.length, 2);
    assert.equal(reply.candidates[0]!.cid, "d_123456");
    assert.equal(reply.candidates[0]!.maker, "サークル森");
    assert.equal(
      reply.candidates.some((c) => c.cid.includes("evil") || c.cid.includes("wish")),
      false,
    );
  });

  it("reads FANZA detail links from classless result-card boundaries", () => {
    const reply = readDiscoverySearchPage(
      "fanza_doujin",
      fanzaClasslessSearchDoc() as unknown as Document,
      "https://www.dmm.co.jp/dc/doujin/-/list/narrow/=/word=test/",
    );
    assert.equal(reply.ok, true);
    if (!reply.ok) return;
    assert.equal(reply.state, "ready");
    if (reply.state !== "ready") return;
    assert.equal(reply.candidates.length, 1);
    assert.equal(reply.candidates[0]!.cid, "d_733274");
    assert.equal(reply.candidates[0]!.title, "クラス変更作品");
    assert.equal(reply.candidates[0]!.maker, "サークル森");
  });

  it("reports age_gate without auto-click", () => {
    const doc = new MockDocument();
    doc.title = "年齢認証";
    const p = doc.createElement("p");
    p.textContent = "年齢認証";
    doc.body.appendChild(p);
    const reply = readDiscoverySearchPage(
      "fanza_doujin",
      doc as unknown as Document,
      "https://www.dmm.co.jp/age_check/=/declared=yes/",
    );
    assert.equal(reply.ok, true);
    if (reply.ok) assert.equal(reply.state, "age_gate");
  });

  it("reports page_not_ready when search containers are absent", () => {
    const doc = new MockDocument();
    doc.title = "loading";
    const reply = readDiscoverySearchPage(
      "dlsite",
      doc as unknown as Document,
      "https://www.dlsite.com/maniax/fsr/=/keyword/test/",
    );
    assert.equal(reply.ok, true);
    if (reply.ok) assert.equal(reply.state, "page_not_ready");
  });

  it("rejects product links under nav/header/footer/aside ul>li as candidates", () => {
    const cases: Array<{
      tag: "nav" | "header" | "footer" | "aside";
      cid: string;
    }> = [
      { tag: "nav", cid: "RJ999777" },
      { tag: "footer", cid: "RJ999666" },
      { tag: "header", cid: "RJ999555" },
      { tag: "aside", cid: "RJ999444" },
    ];
    for (const { tag, cid } of cases) {
      const doc = dlsiteChromeListProductDoc(tag);
      const reply = readDiscoverySearchPage(
        "dlsite",
        doc as unknown as Document,
        "https://www.dlsite.com/maniax/fsr/=/keyword/test/",
      );
      assert.equal(reply.ok, true, `${tag}: reply.ok`);
      if (!reply.ok) return;
      assert.equal(
        reply.state === "ready" ? reply.candidates.length : 0,
        0,
        `${tag}: chrome list product must not become a candidate`,
      );
      if (reply.state === "ready") {
        assert.equal(
          reply.candidates.some((c) => c.cid === cid),
          false,
          `${tag}: cid ${cid} must not appear`,
        );
      }
    }
  });

  it("keeps page_not_ready when only nav list chrome exists on search URL", () => {
    const doc = dlsiteNavListOnlySearchDoc();
    const reply = readDiscoverySearchPage(
      "dlsite",
      doc as unknown as Document,
      "https://www.dlsite.com/maniax/fsr/=/keyword/test/",
    );
    assert.equal(reply.ok, true);
    if (!reply.ok) return;
    assert.equal(
      reply.state,
      "page_not_ready",
      "bare chrome li must not flip zero-candidate search pages to empty",
    );
  });

  it("reads live-like DLsite work_1col table rows (FANZA-origin → DLsite-search path)", () => {
    const doc = dlsiteWork1ColLiveSearchDoc();
    const reply = readDiscoverySearchPage(
      "dlsite",
      doc as unknown as Document,
      "https://www.dlsite.com/maniax/fsr/=/keyword/%E5%AE%8C%E5%A0%95%E3%81%A1/",
    );
    assert.equal(reply.ok, true);
    if (!reply.ok) return;
    assert.equal(
      reply.state,
      "ready",
      "work_1col tr rows must not collapse to empty/no-match",
    );
    if (reply.state !== "ready") return;
    assert.equal(reply.candidates.length, 2);
    assert.equal(reply.candidates[0]!.cid, "RJ01652658");
    assert.equal(
      reply.candidates[0]!.title,
      "【2周年記念110円/差分付き】 完堕ち義母とザコマン後輩",
    );
    assert.equal(reply.candidates[0]!.maker, "ろまあぽ");
    assert.equal(
      reply.candidates[0]!.productUrl,
      "https://www.dlsite.com/maniax/work/=/product_id/RJ01652658.html",
    );
    assert.equal(
      reply.candidates.some((c) => c.cid === "RJ012347"),
      false,
      "non-maniax floors must remain rejected",
    );
    assert.equal(
      reply.candidates.some((c) => /cart|wishlist/i.test(c.productUrl)),
      false,
      "cart/wishlist URLs must remain rejected",
    );
  });

  it("reads live-like FANZA multi-author cards (DLsite-origin → FANZA-search path)", () => {
    const doc = fanzaLiveMultiAuthorSearchDoc();
    const reply = readDiscoverySearchPage(
      "fanza_doujin",
      doc as unknown as Document,
      "https://www.dmm.co.jp/dc/doujin/-/list/narrow/=/word=test/",
    );
    assert.equal(reply.ok, true);
    if (!reply.ok) return;
    assert.equal(reply.state, "ready");
    if (reply.state !== "ready") return;
    assert.equal(reply.candidates.length, 1);
    assert.equal(reply.candidates[0]!.cid, "d_781951");
    assert.equal(
      reply.candidates[0]!.title,
      "【2周年記念110円/差分付き】完堕ち義母とザコマン後輩",
    );
    assert.equal(
      reply.candidates[0]!.maker,
      "ろまあぽ",
      "prefer article=maker circle over creator-suffixed author blob",
    );
    assert.equal(
      reply.candidates[0]!.productUrl,
      "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_781951/",
    );
    assert.equal(
      reply.candidates.some((c) => c.cid.includes("evil")),
      false,
      "basket/non-detail links must remain rejected",
    );
  });
});
