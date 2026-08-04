import { ensureCartStyles } from "./styles.js";

export const ADP_CART_TOAST_ID = "adp-cart-toast";
export const UNDO_TOAST_TEXT = "削除しました — 元に戻す";
export const UNDO_TOAST_MS = 10_000;

function detachNode(node: HTMLElement): void {
  if (typeof node.remove === "function") {
    node.remove();
    return;
  }
  const parent = node.parentNode ?? (node as { parent?: HTMLElement | null }).parent ?? null;
  if (!parent) return;
  if (typeof parent.removeChild === "function") {
    parent.removeChild(node);
    return;
  }
  const mockParent = parent as unknown as { children?: unknown[] };
  if (Array.isArray(mockParent.children)) {
    mockParent.children = mockParent.children.filter((child) => child !== node);
  }
}

export function showUndoToast(doc: Document, onUndo: () => void | Promise<void>): void {
  ensureCartStyles(doc);
  const existing = doc.getElementById(ADP_CART_TOAST_ID);
  if (existing) detachNode(existing);

  const toast = doc.createElement("div");
  toast.id = ADP_CART_TOAST_ID;
  toast.className = "adp-cart-toast";
  toast.setAttribute("role", "status");

  const prefix = doc.createTextNode("削除しました — ");
  toast.appendChild(prefix);

  const undo = doc.createElement("button");
  undo.type = "button";
  undo.className = "adp-cart-toast__undo";
  undo.textContent = "元に戻す";
  undo.onclick = () => {
    clearTimeout(timer);
    detachNode(toast);
    void onUndo();
  };
  toast.appendChild(undo);

  doc.body.appendChild(toast);
  const timer = setTimeout(() => detachNode(toast), UNDO_TOAST_MS);
}
