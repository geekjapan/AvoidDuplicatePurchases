import { parseFixtureDocument, type MockDocument } from "../../test/mock-document.js";

function appendTextChild(parent: ReturnType<MockDocument["createElement"]>, tag: string, className: string, text: string): void {
  const el = parent.ownerDocument!.createElement(tag);
  el.className = className;
  el.textContent = text;
  parent.appendChild(el);
}

/** Build a cart-page mock document with structures the cart parsers expect. */
export function buildCartFixtureDocument(html: string, pageUrl: string): MockDocument {
  const doc = parseFixtureDocument(html, pageUrl);
  const location = doc.location as { href: string; pathname?: string };
  location.pathname = new URL(pageUrl).pathname;

  const csrf = html.match(/name="csrf-token"\s+content="([^"]+)"/)?.[1];
  if (csrf) {
    const meta = doc.createElement("meta");
    meta.setAttribute("name", "csrf-token");
    meta.setAttribute("content", csrf);
    doc.head.appendChild(meta);
  }

  for (const match of html.matchAll(
    /<li class="([^"]*\bcart_list_item\b[^"]*)" data-workno="([^"]+)">([\s\S]*?)<\/li>/g,
  )) {
    const li = doc.createElement("li");
    li.className = match[1]!;
    li.setAttribute("data-workno", match[2]!);
    const block = match[3]!;
    const title = block.match(/class="work_name"[^>]*>([^<]+)</)?.[1]?.trim();
    const maker = block.match(/class="maker_name"[^>]*>([^<]+)</)?.[1]?.trim();
    if (title) appendTextChild(li, "span", "work_name", title);
    if (maker) appendTextChild(li, "span", "maker_name", maker);
    doc.body.appendChild(li);
  }

  for (const match of html.matchAll(
    /<div data-content-id="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g,
  )) {
    const div = doc.createElement("div");
    div.setAttribute("data-content-id", match[1]!);
    const block = match[2]!;
    const title = block.match(/class="title"[^>]*>([^<]+)</)?.[1]?.trim();
    const maker = block.match(/class="maker"[^>]*>([^<]+)</)?.[1]?.trim();
    if (title) appendTextChild(div, "span", "title", title);
    if (maker) appendTextChild(div, "span", "maker", maker);
    doc.body.appendChild(div);
  }

  for (const match of html.matchAll(/<div data-item-id="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g)) {
    const div = doc.createElement("div");
    div.setAttribute("data-item-id", match[1]!);
    const block = match[2]!;
    const title = block.match(/class="title"[^>]*>([^<]+)</)?.[1]?.trim();
    const author = block.match(/class="author"[^>]*>([^<]+)</)?.[1]?.trim();
    if (title) appendTextChild(div, "span", "title", title);
    if (author) appendTextChild(div, "span", "author", author);
    doc.body.appendChild(div);
  }

  for (const match of html.matchAll(
    /<(button|a)([^>]*data-adp-purchase-cta="([^"]+)"[^>]*)>([^<]*)<\/\1>/gi,
  )) {
    const el = doc.createElement(match[1]!);
    if (match[1]!.toLowerCase() === "button") el.setAttribute("type", "button");
    el.setAttribute("data-adp-purchase-cta", match[3]!);
    el.textContent = (match[4] ?? "").trim();
    doc.body.appendChild(el);
  }

  return doc;
}
