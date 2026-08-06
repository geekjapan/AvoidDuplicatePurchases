import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  overlayAnchorForThumbnail,
  readEffectivePosition,
} from "../overlay.js";
import { MockDocument, type MockElement } from "./mock-document.js";

describe("listing overlay host positioning", () => {
  it("reads computed non-static position before inline style", () => {
    const doc = new MockDocument();
    const host = doc.createElement("li");
    host.className = "search_result_img_box";
    // Stylesheet absolute — inline style remains empty.
    host.computedPosition = "absolute";
    host.style.position = "";
    doc.body.appendChild(host);

    assert.equal(readEffectivePosition(host as unknown as HTMLElement), "absolute");
  });

  it("treats missing computed/inline position as static", () => {
    const doc = new MockDocument();
    const host = doc.createElement("li");
    assert.equal(readEffectivePosition(host as unknown as HTMLElement), "static");
  });

  it("does not overwrite computed absolute/fixed/sticky with relative", () => {
    for (const computed of ["absolute", "fixed", "sticky"] as const) {
      const doc = new MockDocument();
      const li = doc.createElement("li");
      li.className = "search_result_img_box";
      li.computedPosition = computed;
      li.style.position = "";
      const anchor = doc.createElement("a") as MockElement;
      anchor.href = "https://www.dlsite.com/maniax/work/=/product_id/RJ111111.html";
      li.appendChild(anchor);
      doc.body.appendChild(li);

      const host = overlayAnchorForThumbnail(anchor as unknown as HTMLAnchorElement);
      assert.equal(host, li as unknown as HTMLElement);
      assert.equal(li.style.position, "", `must keep stylesheet ${computed}`);
      assert.equal(readEffectivePosition(host), computed);
    }
  });

  it("sets relative only when effective position is static", () => {
    const doc = new MockDocument();
    const li = doc.createElement("li");
    li.className = "search_result_img_box";
    // Default computed static (no stylesheet position).
    li.computedPosition = "static";
    li.style.position = "";
    const anchor = doc.createElement("a") as MockElement;
    anchor.href = "https://www.dlsite.com/maniax/work/=/product_id/RJ222222.html";
    li.appendChild(anchor);
    doc.body.appendChild(li);

    const host = overlayAnchorForThumbnail(anchor as unknown as HTMLAnchorElement);
    assert.equal(host, li as unknown as HTMLElement);
    assert.equal(li.style.position, "relative");
  });

  it("leaves already-relative hosts unchanged", () => {
    const doc = new MockDocument();
    const li = doc.createElement("li");
    li.className = "tile";
    li.computedPosition = "relative";
    li.style.position = "relative";
    const anchor = doc.createElement("a") as MockElement;
    li.appendChild(anchor);
    doc.body.appendChild(li);

    overlayAnchorForThumbnail(anchor as unknown as HTMLAnchorElement);
    assert.equal(li.style.position, "relative");
  });
});
