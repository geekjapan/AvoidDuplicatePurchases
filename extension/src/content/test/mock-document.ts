/** Minimal DOM shim for node:test content-script tests. */
export class MockElement {
  tagName: string;
  textContent = "";
  innerHTML = "";
  className = "";
  id = "";
  href = "";
  children: MockElement[] = [];
  parent: MockElement | null = null;
  readonly style = { position: "" };
  private attributes = new Map<string, string>();

  get content(): string {
    return this.getAttribute("content") ?? this.textContent;
  }

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child: MockElement): MockElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  insertAdjacentElement(_position: string, element: MockElement): MockElement {
    this.children.unshift(element);
    element.parent = this;
    return element;
  }

  querySelector(selector: string): MockElement | null {
    if (selector.includes(" ")) {
      const parts = selector.trim().split(/\s+/);
      const parents = this.querySelectorAll(parts[0]!);
      for (const parent of parents) {
        const hit = parent.querySelector(parts.slice(1).join(" "));
        if (hit) return hit;
      }
      return null;
    }
    if (selector.startsWith("#") && this.id === selector.slice(1)) return this;
    if (selector.startsWith(".") && this.className.split(/\s+/).includes(selector.slice(1))) {
      return this;
    }
    if (selector.startsWith("[") && selector.includes("*=")) {
      const attrMatch = /\[([^*]+)\*="([^"]+)"\]/.exec(selector);
      if (attrMatch) {
        const attrName = attrMatch[1]!;
        const needle = attrMatch[2]!;
        const value = this.getAttribute(attrName) ?? this.href;
        if (value.includes(needle)) return this;
      }
    }
    for (const child of this.children) {
      const hit = child.querySelector(selector);
      if (hit) return hit;
    }
    return null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const hits: MockElement[] = [];
    const visit = (node: MockElement): void => {
      if (selector.startsWith(".") && node.className.split(/\s+/).includes(selector.slice(1))) {
        hits.push(node);
      }
      for (const child of node.children) visit(child);
    };
    visit(this);
    return hits;
  }

  closest(selector: string): MockElement | null {
    let node: MockElement | null = this;
    while (node) {
      if (selector.startsWith(".") && node.className.split(/\s+/).includes(selector.slice(1))) {
        return node;
      }
      node = node.parent;
    }
    return null;
  }
}

export class MockDocument {
  readonly head = new MockElement("head");
  readonly body = new MockElement("body");
  readonly location = { href: "" };

  constructor() {
    this.body.parent = null;
  }

  createElement(tag: string): MockElement {
    return new MockElement(tag);
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
    const fromBody = this.body.querySelector(selector);
    if (fromBody) return fromBody;
    return this.head.querySelector(selector);
  }

  querySelectorAll(selector: string): MockElement[] {
    return [...this.body.querySelectorAll(selector), ...this.head.querySelectorAll(selector)];
  }
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

  for (const match of html.matchAll(/<a href="([^"]+)"/g)) {
    const anchor = doc.createElement("a");
    anchor.href = match[1]!;
    doc.body.appendChild(anchor);
  }

  return doc;
}
