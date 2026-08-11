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
.adp-discovery-panel {
  box-sizing: border-box;
  display: block;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  grid-column: 1 / -1;
  flex: 0 1 100%;
  clear: both;
  overflow: hidden;
  margin: 12px 0;
  padding: 12px 14px;
  border-radius: 6px;
  border: 1px solid #90caf9;
  background: #f5faff;
  color: #0d47a1;
  font-size: 13px;
  line-height: 1.5;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
.adp-discovery-panel,
.adp-discovery-panel * {
  box-sizing: border-box;
}
.adp-discovery-start-btn {
  display: inline-block;
  max-width: 100%;
  margin: 0 0 8px;
  padding: 8px 12px;
  border-radius: 4px;
  border: 1px solid #1976d2;
  background: #1976d2;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.adp-discovery-start-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.adp-discovery-status {
  margin: 4px 0 0;
}
.adp-discovery-status[data-kind="error"] {
  color: #b71c1c;
}
.adp-discovery-status[data-kind="ok"] {
  color: #1b5e20;
}
.adp-discovery-status[data-kind="busy"] {
  color: #0d47a1;
}
.adp-discovery-results,
.adp-discovery-candidates {
  margin-top: 10px;
}
.adp-discovery-results__title {
  min-width: 0;
  font-weight: 700;
  margin-bottom: 6px;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.adp-discovery-results__meta {
  min-width: 0;
  margin-bottom: 8px;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.adp-discovery-results__meta a {
  overflow-wrap: anywhere;
  word-break: break-word;
}
.adp-discovery-price-table {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  border-collapse: collapse;
  table-layout: fixed;
  margin: 6px 0;
  font-size: 13px;
}
.adp-discovery-price-table th,
.adp-discovery-price-table td {
  min-width: 0;
  border: 1px solid #bbdefb;
  padding: 4px 8px;
  text-align: left;
  vertical-align: top;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.adp-discovery-price-table th:first-child,
.adp-discovery-price-table td:first-child {
  width: 24%;
}
.adp-discovery-price-table th {
  background: #e3f2fd;
}
.adp-discovery-note {
  min-width: 0;
  margin: 8px 0 0;
  font-size: 12px;
  color: #455a64;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.adp-discovery-candidate-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.adp-discovery-candidate-list li {
  margin: 4px 0;
}
.adp-discovery-candidate-btn {
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 8px;
  border: 1px solid #90caf9;
  border-radius: 4px;
  background: #fff;
  color: #0d47a1;
  cursor: pointer;
  font-size: 13px;
}
.adp-discovery-candidate-btn:hover {
  background: #e3f2fd;
}
`;

export function ensureDisplayStyles(doc: Document): void {
  if (doc.getElementById(ADP_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = ADP_STYLE_ID;
  style.textContent = DISPLAY_CSS;
  doc.head.appendChild(style);
}
