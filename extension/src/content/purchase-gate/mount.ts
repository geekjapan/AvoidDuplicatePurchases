import { findPurchaseCtas } from "./cta.js";
import { gateReasonMessage } from "./messages.js";
import { ensureGateStyles } from "./styles.js";
import {
  ADP_GATE_BANNER_ID,
  ADP_GATED_ATTR,
  type GateSurface,
} from "./types.js";

type InterceptHandler = (event?: Event) => void;

const handlerKey = "__adpGateClickHandler";
const prevOnclickKey = "__adpGatePrevOnclick";

type PreviousCtaState = {
  disabled: boolean | undefined;
  disabledAttribute: string | null;
  ariaDisabledAttribute: string | null;
  tabindexAttribute: string | null;
};

const originalCtaState = new WeakMap<HTMLElement, PreviousCtaState>();

type ElementWithGateHooks = HTMLElement & {
  onclick: ((this: GlobalEventHandlers, ev: MouseEvent) => unknown) | null;
  [handlerKey]?: InterceptHandler;
  [prevOnclickKey]?: ((this: GlobalEventHandlers, ev: MouseEvent) => unknown) | null;
};

function attachIntercept(el: HTMLElement, onBlock: () => void): void {
  const intercept: InterceptHandler = (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const anyEvent = event as { stopImmediatePropagation?: () => void } | undefined;
    anyEvent?.stopImmediatePropagation?.();
    onBlock();
  };

  const record = el as ElementWithGateHooks;
  if (record[handlerKey]) return;

  if (typeof el.addEventListener === "function") {
    el.addEventListener("click", intercept as EventListener, true);
  }
  // onclick fallback for mock DOM used in node:test.
  record[prevOnclickKey] = record.onclick;
  record.onclick = intercept as ElementWithGateHooks["onclick"];
  record[handlerKey] = intercept;
}

function detachIntercept(el: HTMLElement): void {
  const record = el as ElementWithGateHooks;
  const handler = record[handlerKey];
  if (handler && typeof el.removeEventListener === "function") {
    el.removeEventListener("click", handler as EventListener, true);
  }
  if (prevOnclickKey in record) {
    record.onclick = record[prevOnclickKey] ?? null;
    delete record[prevOnclickKey];
  } else if (record.onclick === handler) {
    record.onclick = null;
  }
  delete record[handlerKey];
}

function isFormControl(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  return tag === "button" || tag === "input";
}

function restoreAttribute(el: HTMLElement, name: string, value: string | null): void {
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

function disableCta(el: HTMLElement): void {
  if (el.tagName.toLowerCase() === "button" || el.tagName.toLowerCase() === "input") {
    try {
      originalCtaState.set(el, {
        disabled: (el as HTMLButtonElement).disabled,
        disabledAttribute: el.getAttribute("disabled"),
        ariaDisabledAttribute: el.getAttribute("aria-disabled"),
        tabindexAttribute: el.getAttribute("tabindex"),
      });
    } catch {
      // If a non-standard element throws while reading disabled, preserve attrs.
      originalCtaState.set(el, {
        disabled: undefined,
        disabledAttribute: el.getAttribute("disabled"),
        ariaDisabledAttribute: el.getAttribute("aria-disabled"),
        tabindexAttribute: el.getAttribute("tabindex"),
      });
    }
  } else {
    originalCtaState.set(el, {
      disabled: undefined,
      disabledAttribute: el.getAttribute("disabled"),
      ariaDisabledAttribute: el.getAttribute("aria-disabled"),
      tabindexAttribute: el.getAttribute("tabindex"),
    });
  }
  el.setAttribute(ADP_GATED_ATTR, "1");
  el.setAttribute("aria-disabled", "true");
  if (isFormControl(el)) {
    try {
      (el as HTMLButtonElement).disabled = true;
    } catch {
      // ignore
    }
    el.setAttribute("disabled", "disabled");
  }
  if (el.tagName.toLowerCase() === "a") {
    el.setAttribute("tabindex", "-1");
  }
}

function enableCta(el: HTMLElement): void {
  el.removeAttribute(ADP_GATED_ATTR);
  const previous = originalCtaState.get(el);
  if (previous) {
    if (isFormControl(el) && previous.disabled !== undefined) {
      try {
        (el as HTMLButtonElement).disabled = previous.disabled;
      } catch {
        // ignore
      }
    }
    restoreAttribute(el, "disabled", previous.disabledAttribute);
    restoreAttribute(el, "aria-disabled", previous.ariaDisabledAttribute);
    restoreAttribute(el, "tabindex", previous.tabindexAttribute);
    originalCtaState.delete(el);
  } else {
    el.removeAttribute("aria-disabled");
  }
  if (isFormControl(el) && !previous) {
    try {
      (el as HTMLButtonElement).disabled = false;
    } catch {
      // ignore
    }
    el.removeAttribute("disabled");
  }
  if (el.tagName.toLowerCase() === "a" && !previous) {
    el.removeAttribute("tabindex");
  }
  detachIntercept(el);
}

function mountBanner(doc: Document, reason: string): HTMLElement {
  ensureGateStyles(doc);
  let banner = doc.getElementById(ADP_GATE_BANNER_ID);
  if (banner) {
    banner.textContent = reason;
    return banner;
  }
  banner = doc.createElement("div");
  banner.id = ADP_GATE_BANNER_ID;
  banner.className = "adp-purchase-gate-banner";
  banner.setAttribute("role", "alert");
  banner.textContent = reason;
  const anchor = doc.body ?? doc.documentElement;
  anchor.insertAdjacentElement("afterbegin", banner);
  return banner;
}

/**
 * Mount fail-closed purchase gate: reason banner + disable/intercept CTAs.
 * Returns number of CTAs gated (0 is still valid if only the banner is shown).
 */
export function mountPurchaseGate(doc: Document, surface: GateSurface): number {
  const reason = gateReasonMessage(surface);
  mountBanner(doc, reason);
  const ctas = findPurchaseCtas(doc, surface);
  for (const cta of ctas) {
    if (cta.getAttribute(ADP_GATED_ATTR) === "1") {
      // Keep intercept if already gated.
      attachIntercept(cta, () => {
        mountBanner(doc, reason);
      });
      continue;
    }
    disableCta(cta);
    attachIntercept(cta, () => {
      mountBanner(doc, reason);
    });
  }
  return ctas.length;
}

/** Remove gate banner and re-enable previously gated CTAs on this document. */
export function unmountPurchaseGate(doc: Document): void {
  const banner = doc.getElementById(ADP_GATE_BANNER_ID);
  if (banner?.parentNode) {
    banner.parentNode.removeChild(banner);
  } else if (banner) {
    try {
      banner.remove();
    } catch {
      // ignore
    }
  }
  for (const el of Array.from(doc.querySelectorAll(`[${ADP_GATED_ATTR}="1"]`))) {
    enableCta(el as HTMLElement);
  }
}

export function isPurchaseGateMounted(doc: Document): boolean {
  return Boolean(doc.getElementById(ADP_GATE_BANNER_ID));
}
