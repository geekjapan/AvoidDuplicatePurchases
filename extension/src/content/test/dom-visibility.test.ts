import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isVisible, visibleTextOf } from "../dom-visibility.js";
import { MockDocument } from "./mock-document.js";

describe("isVisible", () => {
  it("accepts a visible MockDocument element", () => {
    const doc = new MockDocument();
    const element = doc.createElement("div");
    doc.body.appendChild(element);

    assert.equal(isVisible(element), true);
  });

  it("rejects hidden and aria-hidden elements", () => {
    const doc = new MockDocument();
    const hidden = doc.createElement("div");
    hidden.setAttribute("hidden", "");
    const ariaHidden = doc.createElement("div");
    ariaHidden.setAttribute("aria-hidden", "true");
    doc.body.appendChild(hidden);
    doc.body.appendChild(ariaHidden);

    assert.equal(isVisible(hidden), false);
    assert.equal(isVisible(ariaHidden), false);
  });

  it("rejects an element whose ancestor is hidden", () => {
    const doc = new MockDocument();
    const hiddenAncestor = doc.createElement("section");
    hiddenAncestor.setAttribute("aria-hidden", "true");
    const child = doc.createElement("span");
    hiddenAncestor.appendChild(child);
    doc.body.appendChild(hiddenAncestor);

    assert.equal(isVisible(child), false);
  });

  it("rejects inline and computed display, visibility, and opacity states", () => {
    const doc = new MockDocument();
    const inlineDisplay = doc.createElement("div");
    inlineDisplay.style.display = "none";
    const inlineVisibility = doc.createElement("div");
    inlineVisibility.setAttribute("style", "visibility: collapse");
    const inlineOpacity = doc.createElement("div");
    inlineOpacity.style.opacity = "0";
    const computedDisplay = doc.createElement("div");
    computedDisplay.computedDisplay = "none";
    const computedVisibility = doc.createElement("div");
    computedVisibility.computedVisibility = "hidden";
    const computedOpacity = doc.createElement("div");
    computedOpacity.computedOpacity = "0";
    for (const element of [
      inlineDisplay,
      inlineVisibility,
      inlineOpacity,
      computedDisplay,
      computedVisibility,
      computedOpacity,
    ]) {
      doc.body.appendChild(element);
    }

    assert.equal(isVisible(inlineDisplay), false);
    assert.equal(isVisible(inlineVisibility), false);
    assert.equal(isVisible(inlineOpacity), false);
    assert.equal(isVisible(computedDisplay), false);
    assert.equal(isVisible(computedVisibility), false);
    assert.equal(isVisible(computedOpacity), false);
  });

  it("fails closed when computed visibility is incomplete", () => {
    const element = {
      nodeType: 1,
      childNodes: [],
      textContent: "unknown",
      parentElement: null,
      getAttribute: () => null,
      hasAttribute: () => false,
      ownerDocument: {
        defaultView: {
          getComputedStyle: () => ({ display: "block", visibility: "visible" }),
        },
      },
    };

    assert.equal(isVisible(element), false);
  });

  it("fails closed for unknown computed CSS values", () => {
    const doc = new MockDocument();
    const unknownDisplay = doc.createElement("div");
    unknownDisplay.computedDisplay = "not-a-display-value";
    const unknownVisibility = doc.createElement("div");
    unknownVisibility.computedVisibility = "not-a-visibility-value";
    const unknownOpacity = doc.createElement("div");
    unknownOpacity.computedOpacity = "not-a-number";
    doc.body.appendChild(unknownDisplay);
    doc.body.appendChild(unknownVisibility);
    doc.body.appendChild(unknownOpacity);

    assert.equal(isVisible(unknownDisplay), false);
    assert.equal(isVisible(unknownVisibility), false);
    assert.equal(isVisible(unknownOpacity), false);
  });
});

describe("visibleTextOf", () => {
  it("concatenates visible text nodes and prunes hidden descendants", () => {
    const doc = new MockDocument();
    const root = doc.createElement("div");
    const visibleChild = doc.createElement("span");
    visibleChild.textContent = "visible child";
    const hiddenChild = doc.createElement("span");
    hiddenChild.textContent = "purchase tab paging";
    hiddenChild.setAttribute("aria-hidden", "true");
    const displayNoneChild = doc.createElement("span");
    displayNoneChild.textContent = "hidden display text";
    displayNoneChild.style.display = "none";
    root.appendChild(doc.createTextNode("visible root "));
    root.appendChild(visibleChild);
    root.appendChild(hiddenChild);
    root.appendChild(displayNoneChild);
    doc.body.appendChild(root);

    assert.equal(visibleTextOf(root), "visible root visible child");
  });

  it("returns no text for an invisible root or text node", () => {
    const doc = new MockDocument();
    const root = doc.createElement("div");
    const text = doc.createTextNode("secret");
    root.appendChild(text);
    root.setAttribute("hidden", "");
    doc.body.appendChild(root);

    assert.equal(visibleTextOf(root), "");
    assert.equal(visibleTextOf(text), "");
  });
});
