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
