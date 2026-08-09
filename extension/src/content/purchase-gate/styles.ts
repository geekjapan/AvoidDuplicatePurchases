export const ADP_GATE_STYLE_ID = "adp-purchase-gate-styles";

export const GATE_CSS = `
.adp-purchase-gate-banner {
  margin: 10px 0 14px;
  padding: 12px 14px;
  border-radius: 6px;
  background: #fdecea;
  border: 1px solid #e57373;
  color: #b71c1c;
  font-size: 14px;
  line-height: 1.5;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-weight: 600;
}
[data-adp-gated="1"] {
  opacity: 0.55 !important;
  cursor: not-allowed !important;
  filter: grayscale(0.15);
}
`;

export function ensureGateStyles(doc: Document): void {
  if (doc.getElementById(ADP_GATE_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = ADP_GATE_STYLE_ID;
  style.textContent = GATE_CSS;
  (doc.head ?? doc.documentElement ?? doc.body).appendChild(style);
}
