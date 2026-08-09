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
    if (name === "disabled") return this.attributes.has("disabled");
    if (name === "href") return Boolean(this.href) || this.attributes.has("href");
    if (name === "class") return Boolean(this.className) || this.attributes.has("class");
    if (name === "id") return Boolean(this.id) || this.attributes.has("id");
    return this.attributes.has(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
    if (name === "href") this.href = "";
    if (name === "class") this.className = "";
    if (name === "id") this.id = "";
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

  removeChild(child: MockElement | MockTextNode): MockElement | MockTextNode {
    this.children = this.children.filter((c) => c !== child);
    this.childNodes = this.childNodes.filter((c) => c !== child);
    if (child instanceof MockElement || child instanceof MockTextNode) {
      child.parent = null;
    }
    return child;
  }

  remove(): void {
    this.parent?.removeChild(this);
  }

  get disabled(): boolean {
    return this.hasAttribute("disabled");
  }

  set disabled(value: boolean) {
    if (value) this.setAttribute("disabled", "disabled");
    else {
      this.attributes.delete("disabled");
    }
  }

  addEventListener(
    _type: string,
    _listener: EventListenerOrEventListenerObject,
    _options?: boolean | AddEventListenerOptions,
  ): void {
    // Capture listeners are not fully simulated; onclick path is used in tests.
  }

  removeEventListener(
    _type: string,
    _listener: EventListenerOrEventListenerObject,
    _options?: boolean | EventListenerOptions,
  ): void {
    // no-op
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
    // Prefer explicit buttons inside work_buy when present in fixture HTML.
    const workBuyBlock =
      /class="work_buy"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
    for (const btn of workBuyBlock.matchAll(
      /<button([^>]*)>([^<]*)<\/button>/gi,
    )) {
      const button = doc.createElement("button");
      button.setAttribute("type", "button");
      const attrs = btn[1] ?? "";
      const cta = /data-adp-purchase-cta="([^"]+)"/.exec(attrs)?.[1];
      if (cta) button.setAttribute("data-adp-purchase-cta", cta);
      button.textContent = (btn[2] ?? "").trim();
      buy.appendChild(button);
    }
    if (buy.children.length === 0) {
      const fallback = doc.createElement("button");
      fallback.setAttribute("type", "button");
      fallback.textContent = "カートに入れる";
      buy.appendChild(fallback);
    }
    doc.body.appendChild(buy);
  }
  if (html.includes('class="m-productPurchase"')) {
    const buy = doc.createElement("div");
    buy.className = "m-productPurchase";
    const block =
      /class="m-productPurchase"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
    for (const btn of block.matchAll(/<button([^>]*)>([^<]*)<\/button>/gi)) {
      const button = doc.createElement("button");
      button.setAttribute("type", "button");
      const attrs = btn[1] ?? "";
      const cta = /data-adp-purchase-cta="([^"]+)"/.exec(attrs)?.[1];
      if (cta) button.setAttribute("data-adp-purchase-cta", cta);
      button.textContent = (btn[2] ?? "").trim();
      buy.appendChild(button);
    }
    if (buy.children.length === 0) {
      const button = doc.createElement("button");
      button.setAttribute("type", "button");
      button.textContent = "購入する";
      buy.appendChild(button);
    }
    doc.body.appendChild(buy);
  }

  // Standalone purchase CTAs (cart progress / checkout) outside product blocks.
  for (const match of html.matchAll(
    /<(button|a)([^>]*data-adp-purchase-cta="([^"]+)"[^>]*)>([^<]*)<\/\1>/gi,
  )) {
    const tag = match[1]!.toLowerCase();
    // Skip if already captured under work_buy / m-productPurchase via nested parse.
    const already = doc.body.querySelectorAll(`[data-adp-purchase-cta="${match[3]}"]`);
    // Always allow multiple CTAs of same role; only skip exact text+role dups later if needed.
    void already;
    const el = doc.createElement(tag);
    if (tag === "button") el.setAttribute("type", "button");
    el.setAttribute("data-adp-purchase-cta", match[3]!);
    el.textContent = (match[4] ?? "").trim();
    // Avoid double-appending buttons already nested under work_buy / purchase blocks.
    const nestedInKnown =
      /class="(?:work_buy|m-productPurchase)"[^>]*>[\s\S]*?data-adp-purchase-cta="/.test(
        html,
      ) &&
      (match[3] === "immediate-buy" || match[3] === "cart-add");
    if (nestedInKnown && (match[3] === "immediate-buy" || match[3] === "cart-add")) {
      // If the CTA appears inside product blocks, the block parsers above own it.
      const insideProduct =
        html.includes('class="work_buy"') || html.includes('class="m-productPurchase"');
      if (insideProduct && /work_buy|m-productPurchase/.test(html.slice(0, html.indexOf(match[0]!)))) {
        // Heuristic: product fixtures — skip top-level re-append for product CTAs.
        continue;
      }
    }
    doc.body.appendChild(el);
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
