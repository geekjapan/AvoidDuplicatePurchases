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
});
