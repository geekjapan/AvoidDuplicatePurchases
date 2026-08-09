/** Where the fail-closed gate is applied. */
export type GateSurface = "immediate_buy" | "cart" | "purchase_progress";

/**
 * CTA role markers for synthetic fixtures and (when present) live DOM.
 * Live stores may lack these attributes; heuristics still apply.
 */
export type PurchaseCtaRole =
  | "immediate-buy"
  | "cart-add"
  | "cart-progress"
  | "purchase-progress";

export const ADP_GATE_BANNER_ID = "adp-purchase-gate-banner";
export const ADP_GATED_ATTR = "data-adp-gated";
export const ADP_CTA_ATTR = "data-adp-purchase-cta";
