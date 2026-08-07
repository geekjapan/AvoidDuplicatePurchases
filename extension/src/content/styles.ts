export const ADP_STYLE_ID = "adp-display-styles";

export const DISPLAY_CSS = `
.adp-purchased-banner {
  margin: 12px 0;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 14px;
  line-height: 1.5;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
.adp-purchased-banner--owned {
  background: #e8f5e9;
  border: 1px solid #81c784;
  color: #1b5e20;
}
.adp-purchased-banner--other {
  background: #fff8e1;
  border: 1px solid #ffca28;
  color: #6d4c00;
}
.adp-purchased-banner--possible {
  background: #e3f2fd;
  border: 1px solid #90caf9;
  color: #0d47a1;
}
.adp-purchased-banner a {
  color: inherit;
  font-weight: 600;
}
.adp-listing-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(46, 125, 50, 0.92);
  color: #fff;
  font-size: 14px;
  line-height: 22px;
  text-align: center;
  font-weight: 700;
  pointer-events: none;
  z-index: 5;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
}
`;

export function ensureDisplayStyles(doc: Document): void {
  if (doc.getElementById(ADP_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = ADP_STYLE_ID;
  style.textContent = DISPLAY_CSS;
  doc.head.appendChild(style);
}
