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

/**
 * Duplicate-mount guard: never interpolate raw cid into a CSS selector.
 * Attribute presence + exact getAttribute string compare (no CSS.escape).
 */
function hasMountedWarningForCid(host: Element, cid: string): boolean {
  const candidates = host.querySelectorAll(`.${ADP_CART_WARNING_CLASS}`);
  for (const el of Array.from(candidates)) {
    if (el.getAttribute(MOUNT_ATTR) === cid) return true;
  }
  return false;
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
    // Final catch at UI event boundary — never leak unhandled rejection.
    try {
      const result = onDelete();
      void Promise.resolve(result).catch(() => {});
    } catch {
      // sync throw from onDelete
    }
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
  if (hasMountedWarningForCid(row.host, row.cid)) return;
  const warning = renderCartWarning(doc, row, hit, () => {
    void handleDelete(doc, row.cid, deleter, onDeleted).catch(() => {});
  });
  row.host.insertAdjacentElement("afterbegin", warning);
}

/**
 * Delete click handler. On reject / non-ok: no success toast, no incorrect DOM
 * mutation; warning + delete control stay mounted and retryable.
 */
async function handleDelete(
  doc: Document,
  cid: string,
  deleter: CartDeleter,
  onDeleted?: (cid: string) => void,
): Promise<void> {
  try {
    const result = await deleter.remove([cid]);
    if (!result.ok.includes(cid)) return;
    onDeleted?.(cid);
    showUndoToast(doc, async () => {
      try {
        await deleter.restore([cid]);
      } catch {
        // Undo boundary: absorb restore failures (no unhandled rejection).
      }
    });
  } catch {
    // UI event boundary: absorb remove failures; keep warning retryable.
  }
}
