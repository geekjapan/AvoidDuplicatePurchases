import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockDocument } from "../test/mock-document.js";
import { readDiscoveryProductPage } from "./product-reader.js";

function dlsiteProductDoc(cid: string, title: string, maker: string): MockDocument {
  const doc = new MockDocument();
  doc.title = title;
  const link = doc.createElement("link");
  link.setAttribute("rel", "canonical");
  (link as { href?: string }).href =
    `https://www.dlsite.com/maniax/work/=/product_id/${cid}.html`;
  doc.head.appendChild(link);

  const h1 = doc.createElement("h1");
  h1.id = "work_name";
  h1.textContent = title;
  doc.body.appendChild(h1);

  const makerWrap = doc.createElement("div");
  makerWrap.className = "maker_name";
  const makerA = doc.createElement("a");
  makerA.textContent = maker;
  makerWrap.appendChild(makerA);
  doc.body.appendChild(makerWrap);

  // One labeled regular price tier.
  const row = doc.createElement("div");
  const lab = doc.createElement("span");
  lab.textContent = "サークル設定価格";
  const amt = doc.createElement("span");
  amt.textContent = "1,100円（税込）";
  row.appendChild(lab);
  row.appendChild(amt);
  doc.body.appendChild(row);

  return doc;
}

describe("discovery product reader", () => {
  it("returns ready tiers when expected cid matches", () => {
    const doc = dlsiteProductDoc("RJ000001", "合成タイトル", "サークルA");
    const reply = readDiscoveryProductPage(
      "dlsite",
      "RJ000001",
      doc as unknown as Document,
      "https://www.dlsite.com/maniax/work/=/product_id/RJ000001.html",
    );
    assert.equal(reply.ok, true);
    if (!reply.ok) return;
    assert.equal(reply.state, "ready");
    if (reply.state !== "ready") return;
    assert.equal(reply.cid, "RJ000001");
    assert.equal(reply.title, "合成タイトル");
    assert.equal(reply.tiers.regular?.amountMinor, 1100);
  });

  it("fails closed on cid mismatch", () => {
    const doc = dlsiteProductDoc("RJ000001", "合成タイトル", "サークルA");
    const reply = readDiscoveryProductPage(
      "dlsite",
      "RJ999999",
      doc as unknown as Document,
      "https://www.dlsite.com/maniax/work/=/product_id/RJ000001.html",
    );
    assert.equal(reply.ok, true);
    if (!reply.ok) return;
    assert.equal(reply.state, "mismatch");
  });

  it("reports page_not_ready for non-product paths", () => {
    const doc = new MockDocument();
    const reply = readDiscoveryProductPage(
      "dlsite",
      "RJ000001",
      doc as unknown as Document,
      "https://www.dlsite.com/maniax/fsr/=/keyword/test/",
    );
    assert.equal(reply.ok, true);
    if (reply.ok) assert.equal(reply.state, "page_not_ready");
  });
});
