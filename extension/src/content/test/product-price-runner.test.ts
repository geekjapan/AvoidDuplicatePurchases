import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runProductPageWithLookup } from "../product-runner.js";
import { MockDocument } from "./mock-document.js";

describe("product runner price observation gate", () => {
  it("reports prices only after owned lookup succeeds", async () => {
    const doc = new MockDocument();
    const h1 = doc.createElement("h1");
    h1.id = "work_name";
    h1.textContent = "合成タイトル";
    doc.body.appendChild(h1);
    const link = doc.createElement("link");
    link.setAttribute("rel", "canonical");
    link.href = "https://www.dlsite.com/maniax/work/=/product_id/RJ000001.html";
    doc.head.appendChild(link);
    const row = doc.createElement("div");
    const lab = doc.createElement("span");
    lab.textContent = "サークル設定価格";
    const amt = doc.createElement("span");
    amt.textContent = "1,100円";
    row.appendChild(lab);
    row.appendChild(amt);
    doc.body.appendChild(row);

    const sent: unknown[] = [];
    const chromeMock = {
      runtime: {
        sendMessage: async (msg: unknown) => {
          sent.push(msg);
          return { ok: true };
        },
      },
    };
    (globalThis as { chrome?: unknown }).chrome = chromeMock;

    await runProductPageWithLookup(
      "dlsite",
      doc as unknown as Document,
      async () => [{ owned: true, other: [] }],
      "https://www.dlsite.com/maniax/work/=/product_id/RJ000001.html",
    );
    // Allow fire-and-forget report to settle.
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(sent.length, 1);
    const msg = sent[0] as {
      type: string;
      source: string;
      cid: string;
      regular: { amountMinor: number } | null;
    };
    assert.equal(msg.type, "adp:price-observation");
    assert.equal(msg.source, "dlsite");
    assert.equal(msg.cid, "RJ000001");
    assert.equal(msg.regular?.amountMinor, 1100);

    sent.length = 0;
    await runProductPageWithLookup(
      "dlsite",
      doc as unknown as Document,
      async () => [{ owned: false, other: [] }],
      "https://www.dlsite.com/maniax/work/=/product_id/RJ000001.html",
    );
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(sent.length, 0);

    delete (globalThis as { chrome?: unknown }).chrome;
  });
});
