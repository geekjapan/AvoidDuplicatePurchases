export function queryFirst(doc: Document, selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const node = doc.querySelector<HTMLElement>(selector);
    if (node) return node;
  }
  return null;
}
