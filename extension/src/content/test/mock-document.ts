/** Minimal DOM shim for node:test content-script tests. */
export class MockTextNode {
  readonly nodeType = 3;
  textContent: string;
  parent: MockElement | null = null;
  constructor(text: string) {
    this.textContent = text;
  }

  get parentNode(): MockElement | null {
    return this.parent;
  }
}

export class MockElement {
  tagName: string;
  readonly nodeType = 1;
  private _textContent = "";
  innerHTML = "";
  className = "";
  id = "";
  href = "";
  hidden = false;
  children: MockElement[] = [];
  /** Direct child nodes including text (for label-own-text walks). */
  childNodes: Array<MockElement | MockTextNode> = [];
  parent: MockElement | null = null;
  ownerDocument: MockDocument | null = null;
  /**
   * Optional stylesheet-computed position override for overlay tests.
   * When unset, getComputedStyle falls back to inline style then static.
   */
  computedPosition: string | undefined;
  /** Optional stylesheet-computed visibility overrides for DOM-reader tests. */
  computedDisplay: string | undefined;
  computedVisibility: string | undefined;
  computedOpacity: string | undefined;
  computedStyle:
    | {
        display?: string;
        visibility?: string;
        opacity?: string;
        position?: string;
      }
    | undefined;
  readonly style = {
    display: "",
    visibility: "",
    opacity: "",
    position: "",
  };
  private attributes = new Map<string, string>();

  get content(): string {
    return this.getAttribute("content") ?? this.textContent;
  }

  get textContent(): string {
    if (this.childNodes.length === 0) return this._textContent;
    return this.childNodes.map((child) => child.textContent ?? "").join("");
  }

  set textContent(value: string) {
    this._textContent = value;
    this.children = [];
    this.childNodes = value ? [new MockTextNode(value)] : [];
    for (const node of this.childNodes) node.parent = this;
  }

  get parentElement(): MockElement | null {
    return this.parent;
  }

  get parentNode(): MockElement | null {
    return this.parent;
  }

  get nextElementSibling(): MockElement | null {
    if (!this.parent) return null;
    const idx = this.parent.children.indexOf(this);
    return idx >= 0 ? (this.parent.children[idx + 1] ?? null) : null;
  }

  get previousElementSibling(): MockElement | null {
    if (!this.parent) return null;
    const idx = this.parent.children.indexOf(this);
    return idx > 0 ? (this.parent.children[idx - 1] ?? null) : null;
  }

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === "href") this.href = value;
    if (name === "class") this.className = value;
    if (name === "id") this.id = value;
  }

  getAttribute(name: string): string | null {
    if (name === "href" && this.href) return this.href;
    if (name === "class" && this.className) return this.className;
    if (name === "id" && this.id) return this.id;
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  private adoptDocument(ownerDocument: MockDocument): void {
    this.ownerDocument = ownerDocument;
    for (const child of this.children) child.adoptDocument(ownerDocument);
  }

  appendChild(child: MockElement | MockTextNode): MockElement | MockTextNode {
    child.parent = this;
    if (child instanceof MockElement && this.ownerDocument) child.adoptDocument(this.ownerDocument);
    this.childNodes.push(child);
    if (child instanceof MockElement) this.children.push(child);
    return child;
  }

  insertAdjacentElement(_position: string, element: MockElement): MockElement {
    this.children.unshift(element);
    this.childNodes.unshift(element);
    element.parent = this;
    if (this.ownerDocument) element.adoptDocument(this.ownerDocument);
    return element;
  }

  matchesSelector(selector: string): boolean {
    const parts = selector
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.some((part) => this.matchesSimpleSelector(part));
  }

  private matchesSimpleSelector(selector: string): boolean {
    if (selector === "*") return true;
    // tag[attr="value"] / tag[attr*="value"] / tag[attr^="value"] / [attr=...]
    const attrPrefix = /^([a-zA-Z][\w-]*)?\[([^^\]]+)\^="([^"]+)"\]$/.exec(selector);
    if (attrPrefix) {
      const tag = attrPrefix[1];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      const value = this.getAttribute(attrPrefix[2]!) ?? this.href;
      return value.startsWith(attrPrefix[3]!);
    }
    const attrExact = /^([a-zA-Z][\w-]*)?\[([^=\]]+)="([^"]+)"\]$/.exec(selector);
    if (attrExact) {
      const tag = attrExact[1];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      return this.getAttribute(attrExact[2]!) === attrExact[3];
    }
    const attrContains = /^([a-zA-Z][\w-]*)?\[([^*]+)\*="([^"]+)"\]$/.exec(selector);
    if (attrContains) {
      const tag = attrContains[1];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      const value = this.getAttribute(attrContains[2]!) ?? this.href;
      return value.includes(attrContains[3]!);
    }
    const idAndClass = /^#([\w-]+)(?:\.([\w-]+))?$/.exec(selector);
    if (idAndClass) {
      return (
        this.id === idAndClass[1] &&
        (idAndClass[2] === undefined || this.className.split(/\s+/).includes(idAndClass[2]))
      );
    }
    if (selector.startsWith(".")) {
      return this.className.split(/\s+/).includes(selector.slice(1));
    }
    if (/^[a-zA-Z][\w-]*$/.test(selector)) {
      return this.tagName === selector.toUpperCase();
    }
    return false;
  }

  querySelector(selector: string): MockElement | null {
    if (selector.includes(" ") && !selector.includes("[")) {
      const parts = selector.trim().split(/\s+/);
      const parents = this.querySelectorAll(parts[0]!);
      for (const parent of parents) {
        const hit = parent.querySelector(parts.slice(1).join(" "));
        if (hit) return hit;
      }
      return null;
    }
    for (const child of this.children) {
      if (child.matchesSelector(selector)) return child;
      const hit = child.querySelector(selector);
      if (hit) return hit;
    }
    return null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const hits: MockElement[] = [];
    const visit = (node: MockElement): void => {
      if (node.matchesSelector(selector)) hits.push(node);
      for (const child of node.children) visit(child);
    };
    for (const child of this.children) visit(child);
    return hits;
  }

  closest(selector: string): MockElement | null {
    // Check self first to avoid `this` aliasing (no-this-alias).
    if (this.matchesSelector(selector)) return this;
    let node: MockElement | null = this.parent;
    while (node) {
      if (node.matchesSelector(selector)) return node;
      node = node.parent;
    }
    return null;
  }
}

export class MockDocument {
  readonly head = new MockElement("head");
  readonly body = new MockElement("body");
  readonly location = { href: "" };
  readonly defaultView = {
    getComputedStyle: (el: MockElement) => ({
      display:
        el.computedStyle?.display ?? el.computedDisplay ?? (el.style.display || "block"),
      visibility:
        el.computedStyle?.visibility ?? el.computedVisibility ?? (el.style.visibility || "visible"),
      opacity: el.computedStyle?.opacity ?? el.computedOpacity ?? (el.style.opacity || "1"),
      position:
        el.computedStyle?.position ?? el.computedPosition ?? (el.style.position || "static"),
    }),
  };

  constructor() {
    this.head.ownerDocument = this;
    this.body.ownerDocument = this;
    this.body.parent = null;
  }

  createElement(tag: string): MockElement {
    const el = new MockElement(tag);
    el.ownerDocument = this;
    return el;
  }

  createTextNode(text: string): MockTextNode {
    return new MockTextNode(text);
  }

  getElementById(id: string): MockElement | null {
    const find = (node: MockElement): MockElement | null => {
      if (node.id === id) return node;
      for (const child of node.children) {
        const hit = find(child);
        if (hit) return hit;
      }
      return null;
    };
    return find(this.body) ?? find(this.head);
  }

  getElementsByTagName(tag: string): { length: number; item(index: number): MockElement | null } {
    const wanted = tag.toUpperCase();
    const hits: MockElement[] = [];
    const visit = (node: MockElement): void => {
      if (node.tagName === wanted) hits.push(node);
      for (const child of node.children) visit(child);
    };
    visit(this.head);
    visit(this.body);
    return {
      length: hits.length,
      item: (index: number) => hits[index] ?? null,
    };
  }

  querySelector(selector: string): MockElement | null {
    if (selector === "main") return null;
    if (selector === "body") return this.body;
    // Document-level query: match head/body descendants (and head/body themselves).
    if (this.head.matchesSelector(selector)) return this.head;
    if (this.body.matchesSelector(selector)) return this.body;
    const fromBody = this.body.querySelector(selector);
    if (fromBody) return fromBody;
    return this.head.querySelector(selector);
  }

  querySelectorAll(selector: string): MockElement[] {
    return [...this.body.querySelectorAll(selector), ...this.head.querySelectorAll(selector)];
  }
}

function parseImgAttrs(attrs: string | undefined): { src?: string; alt?: string } {
  if (!attrs) return {};
  return {
    src: /src="([^"]+)"/.exec(attrs)?.[1],
    alt: /alt="([^"]+)"/.exec(attrs)?.[1],
  };
}

function appendAnchorWithOptionalImg(
  parent: MockElement,
  href: string,
  imgAttrs?: string,
): MockElement {
  const anchor = new MockElement("a");
  anchor.href = href;
  if (imgAttrs !== undefined) {
    const img = new MockElement("img");
    const parsed = parseImgAttrs(imgAttrs);
    if (parsed.src) img.setAttribute("src", parsed.src);
    if (parsed.alt) img.setAttribute("alt", parsed.alt);
    anchor.appendChild(img);
  }
  parent.appendChild(anchor);
  return anchor;
}

export function parseFixtureDocument(html: string, pageUrl: string): MockDocument {
  const doc = new MockDocument();
  doc.location.href = pageUrl;

  const canonical = html.match(/rel="canonical" href="([^"]+)"/)?.[1];
  const ogUrl = html.match(/property="og:url" content="([^"]+)"/)?.[1];
  if (canonical) {
    const link = doc.createElement("link");
    link.setAttribute("rel", "canonical");
    link.href = canonical;
    doc.head.appendChild(link);
  }
  if (ogUrl) {
    const meta = doc.createElement("meta");
    meta.setAttribute("property", "og:url");
    meta.setAttribute("content", ogUrl);
    doc.head.appendChild(meta);
  }

  const ogTitle = html.match(/property="og:title" content="([^"]+)"/)?.[1];
  if (ogTitle) {
    const meta = doc.createElement("meta");
    meta.setAttribute("property", "og:title");
    meta.setAttribute("content", ogTitle);
    doc.head.appendChild(meta);
  }

  const jsonLd = html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
  if (jsonLd) {
    const script = doc.createElement("script");
    script.setAttribute("type", "application/ld+json");
    script.textContent = jsonLd[1]!;
    doc.head.appendChild(script);
  }

  const workName = html.match(/<h1[^>]*id="work_name"[^>]*>([^<]+)</);
  if (workName) {
    const h1 = doc.createElement("h1");
    h1.id = "work_name";
    h1.textContent = workName[1]!.trim();
    doc.body.appendChild(h1);
  }

  const h1Plain = html.match(/<h1>([^<]+)</);
  if (!workName && h1Plain) {
    const h1 = doc.createElement("h1");
    h1.textContent = h1Plain[1]!.trim();
    doc.body.appendChild(h1);
  }

  const maker = html.match(/class="maker_name"[^>]*><a[^>]*>([^<]+)</);
  if (maker) {
    const wrap = doc.createElement("div");
    wrap.className = "maker_name";
    const link = doc.createElement("a");
    link.textContent = maker[1]!.trim();
    wrap.appendChild(link);
    doc.body.appendChild(wrap);
  }

  if (html.includes('class="work_buy"')) {
    const buy = doc.createElement("div");
    buy.className = "work_buy";
    doc.body.appendChild(buy);
  }
  if (html.includes('class="m-productPurchase"')) {
    const buy = doc.createElement("div");
    buy.className = "m-productPurchase";
    doc.body.appendChild(buy);
  }

  // Preserve listing image/container hierarchy used by overlay host selection.
  const listItems = [
    ...html.matchAll(
      /<li([^>]*)>\s*<a href="([^"]+)"[^>]*>\s*(?:<img([^>]*)\/?>)?\s*<\/a>\s*<\/li>/gi,
    ),
  ];
  if (listItems.length > 0) {
    for (const match of listItems) {
      const li = doc.createElement("li");
      const className = /class="([^"]+)"/.exec(match[1]!)?.[1];
      if (className) li.className = className;
      appendAnchorWithOptionalImg(li, match[2]!, match[3]);
      doc.body.appendChild(li);
    }
    return doc;
  }

  const anchors = [
    ...html.matchAll(/<a href="([^"]+)"[^>]*>\s*(?:<img([^>]*)\/?>)?\s*<\/a>/gi),
  ];
  for (const match of anchors) {
    appendAnchorWithOptionalImg(doc.body, match[1]!, match[2]);
  }

  return doc;
}
