import type { CartDeleter } from "../../cart-deleter/index.js";
import type { LookupHit } from "../types.js";
import { ensureCartStyles } from "./styles.js";
import { showUndoToast } from "./toast.js";
import type { CartRow } from "./types.js";

export const ADP_CART_WARNING_CLASS = "adp-cart-warning";
const MOUNT_ATTR = "data-adp-cart-warning";

function warningMessage(hit: LookupHit): string {
  if (hit.owned) return "⚠ 購入済み";
  if (hit.other.length > 0) return "⚠ 他サイトで購入済み";
  return "";
}

export function renderCartWarning(
  doc: Document,
  row: CartRow,
  hit: LookupHit,
  onDelete: () => void,
): HTMLElement {
  ensureCartStyles(doc);
  const wrap = doc.createElement("div");
  wrap.className = `${ADP_CART_WARNING_CLASS}${hit.owned ? " adp-cart-warning--owned" : ""}`;
  wrap.setAttribute(MOUNT_ATTR, row.cid);

  const badge = doc.createElement("span");
  badge.className = "adp-cart-warning__badge";
  badge.textContent = warningMessage(hit);
  wrap.appendChild(badge);

  const button = doc.createElement("button");
  button.type = "button";
  button.className = "adp-cart-warning__delete";
  button.textContent = "削除";
  button.onclick = (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    onDelete();
  };
  wrap.appendChild(button);
  return wrap;
}

export function mountCartWarning(
  doc: Document,
  row: CartRow,
  hit: LookupHit,
  deleter: CartDeleter,
  onDeleted?: (cid: string) => void,
): void {
  if (row.host.querySelector(`[${MOUNT_ATTR}="${row.cid}"]`)) return;
  const warning = renderCartWarning(doc, row, hit, () => {
    void handleDelete(doc, row.cid, deleter, onDeleted);
  });
  row.host.insertAdjacentElement("afterbegin", warning);
}

async function handleDelete(
  doc: Document,
  cid: string,
  deleter: CartDeleter,
  onDeleted?: (cid: string) => void,
): Promise<void> {
  const result = await deleter.remove([cid]);
  if (!result.ok.includes(cid)) return;
  onDeleted?.(cid);
  showUndoToast(doc, () => deleter.restore([cid]));
}
