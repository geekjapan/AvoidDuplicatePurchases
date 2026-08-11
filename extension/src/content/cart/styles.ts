export const ADP_CART_STYLE_ID = "adp-cart-styles";

export const CART_CSS = `
.adp-cart-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: #fff8e1;
  border: 1px solid #ffca28;
  color: #6d4c00;
  font-size: 13px;
  line-height: 1.4;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
.adp-cart-warning--owned {
  background: #fff3e0;
  border-color: #ffb74d;
}
.adp-cart-warning__badge {
  font-weight: 700;
  white-space: nowrap;
}
.adp-cart-warning__delete {
  margin-left: auto;
  padding: 4px 10px;
  border: 1px solid #c62828;
  border-radius: 4px;
  background: #fff;
  color: #c62828;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.adp-cart-warning__delete:hover {
  background: #ffebee;
}
.adp-cart-price-comparison {
  box-sizing: border-box;
  display: block;
  max-width: 100%;
  min-width: 0;
  margin: 6px 0;
  padding: 6px 8px;
  border: 1px solid #90caf9;
  border-radius: 5px;
  background: #f5faff;
  color: #0d47a1;
  font-size: 12px;
  line-height: 1.45;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.adp-cart-price-comparison,
.adp-cart-price-comparison * {
  box-sizing: border-box;
}
.adp-cart-price-comparison__button {
  max-width: 100%;
  padding: 4px 8px;
  border: 1px solid #1976d2;
  border-radius: 4px;
  background: #1976d2;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.adp-cart-price-comparison__button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.adp-cart-price-comparison__status {
  margin: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.adp-cart-price-comparison__status[data-kind="error"] {
  color: #b71c1c;
}
.adp-cart-price-comparison__status[data-kind="ok"] {
  color: #1b5e20;
}
.adp-cart-price-comparison__status[data-kind="busy"] {
  color: #0d47a1;
}
.adp-cart-price-comparison__prices {
  display: inline;
  font-weight: 600;
}
.adp-cart-price-comparison__link {
  margin-left: 6px;
  color: #0d47a1;
  font-weight: 600;
  text-decoration: underline;
}
.adp-cart-price-comparison__candidates {
  display: grid;
  gap: 4px;
  margin-top: 5px;
}
.adp-cart-price-comparison__candidate {
  max-width: 100%;
  padding: 3px 6px;
  border: 1px solid #90caf9;
  border-radius: 4px;
  background: #fff;
  color: #0d47a1;
  text-align: left;
  font-size: 12px;
  overflow-wrap: anywhere;
  word-break: break-word;
  cursor: pointer;
}
.adp-cart-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147483646;
  padding: 12px 16px;
  border-radius: 8px;
  background: rgba(33, 33, 33, 0.94);
  color: #fff;
  font-size: 14px;
  line-height: 1.4;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
}
.adp-cart-toast__undo {
  margin-left: 8px;
  padding: 0;
  border: none;
  background: none;
  color: #90caf9;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
}
`;

export function ensureCartStyles(doc: Document): void {
  if (doc.getElementById(ADP_CART_STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = ADP_CART_STYLE_ID;
  style.textContent = CART_CSS;
  doc.head.appendChild(style);
}
