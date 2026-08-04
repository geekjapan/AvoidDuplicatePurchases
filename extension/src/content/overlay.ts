import { ensureDisplayStyles } from "./styles.js";

const BADGE_CLASS = "adp-listing-badge";
const VOID_HOST_TAGS = new Set(["IMG", "INPUT", "BR", "HR", "META", "LINK", "SOURCE", "AREA"]);
const POSITIONED = new Set(["relative", "absolute", "fixed", "sticky"]);

/**
 * Effective CSS position: prefer computed style so stylesheet absolute/fixed/sticky
 * hosts are not overwritten with relative. Falls back to inline, then static.
 */
export function readEffectivePosition(host: HTMLElement): string {
  const view = host.ownerDocument?.defaultView;
  if (view && typeof view.getComputedStyle === "function") {
    try {
      const computed = view.getComputedStyle(host).position;
      if (computed) return computed;
    } catch {
      // Some test shims may throw; fall through to inline.
    }
  }
  const inline = host.style.position?.trim();
  return inline || "static";
}

/**
 * Prefer a non-void positioned host (thumbnail container or the anchor itself).
 * Never mount under img — void elements cannot display children.
 * Only force position:relative when the effective (computed) position is static.
 */
export function overlayAnchorForThumbnail(anchor: HTMLAnchorElement): HTMLElement {
  const container = anchor.closest(
    "li, article, .tile, .item, .product, .work_box, .search_result_img_box",
  ) as HTMLElement | null;
  const host = container ?? anchor;
  if (VOID_HOST_TAGS.has(host.tagName)) {
    return anchor;
  }
  if (!POSITIONED.has(readEffectivePosition(host))) {
    host.style.position = "relative";
  }
  return host;
}

export function renderListingBadge(doc: Document): HTMLSpanElement {
  const badge = doc.createElement("span");
  badge.className = BADGE_CLASS;
  badge.setAttribute("aria-label", "購入済み");
  badge.textContent = "✓";
  return badge;
}

export function mountListingBadge(doc: Document, anchor: HTMLAnchorElement): void {
  const host = overlayAnchorForThumbnail(anchor);
  if (VOID_HOST_TAGS.has(host.tagName)) return;
  if (host.querySelector(`.${BADGE_CLASS}`)) return;
  ensureDisplayStyles(doc);
  host.appendChild(renderListingBadge(doc));
}

export function applyListingOverlays(
  doc: Document,
  ownedByCid: Map<string, boolean>,
  anchorsByCid: Map<string, HTMLAnchorElement>,
): void {
  for (const [cid, owned] of ownedByCid) {
    if (!owned) continue;
    const anchor = anchorsByCid.get(cid);
    if (!anchor) continue;
    mountListingBadge(doc, anchor);
  }
}
