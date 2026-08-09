/**
 * The small DOM surface shared by library readers.
 *
 * The functions in this module deliberately accept `unknown`: provider
 * readers run against the browser DOM, while their tests use the structural
 * MockDocument in `content/test`. Runtime checks keep the common surface
 * type-safe without making production code import a test-only shim.
 */

interface VisibilityStyle {
  display: string;
  visibility: string;
  opacity: string;
}

interface ElementLike {
  readonly nodeType: number;
  readonly childNodes: ArrayLike<unknown>;
  readonly textContent: string | null;
}

interface TextNodeLike {
  readonly nodeType: number;
  readonly textContent: string | null;
}

interface ParentResult {
  known: boolean;
  value: ElementLike | null;
}

type StyleVisibility = "visible" | "hidden" | "unknown";

const DISPLAY_TOKENS = new Set([
  "block",
  "inline",
  "run-in",
  "flow",
  "flow-root",
  "table",
  "flex",
  "grid",
  "ruby",
  "list-item",
  "contents",
  "box",
  "inline-block",
  "inline-table",
  "inline-flex",
  "inline-grid",
  "inline-ruby",
  "table-row-group",
  "table-header-group",
  "table-footer-group",
  "table-row",
  "table-cell",
  "table-column-group",
  "table-column",
  "table-caption",
  "ruby-base",
  "ruby-text",
  "ruby-base-container",
  "ruby-text-container",
  "-webkit-box",
  "-webkit-inline-box",
  "-webkit-flex",
  "-webkit-inline-flex",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function propertyExists(value: unknown, property: string): boolean {
  return isRecord(value) && property in value;
}

function readProperty(value: unknown, property: string): unknown {
  if (!isRecord(value)) return undefined;
  try {
    return value[property];
  } catch {
    return undefined;
  }
}

function isElementLike(value: unknown): value is ElementLike {
  return readProperty(value, "nodeType") === 1;
}

function isTextNodeLike(value: unknown): value is TextNodeLike {
  return readProperty(value, "nodeType") === 3;
}

function textContentOf(value: unknown): string {
  const text = readProperty(value, "textContent");
  return typeof text === "string" ? text : "";
}

function attributeOf(element: ElementLike, name: string): string | null {
  const getAttribute = readProperty(element, "getAttribute");
  if (typeof getAttribute !== "function") return null;
  try {
    const value = (getAttribute as (attributeName: string) => unknown).call(element, name);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

function hasAttribute(element: ElementLike, name: string): boolean {
  const hasAttributeMethod = readProperty(element, "hasAttribute");
  if (typeof hasAttributeMethod === "function") {
    try {
      const result = (hasAttributeMethod as (attributeName: string) => unknown).call(
        element,
        name,
      );
      if (typeof result === "boolean") return result;
    } catch {
      // Fall through to getAttribute, which is enough for the DOM shims.
    }
  }
  return attributeOf(element, name) !== null;
}

function normalizeCssValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s*!important\s*$/, "");
}

function inlineDeclaration(styleText: string, property: string): string | null {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|;)\\s*${escapedProperty}\\s*:\\s*([^;]*)`, "i").exec(
    styleText,
  );
  return match?.[1]?.trim() || null;
}

function inlineStyleValue(element: ElementLike, property: string): string | null {
  const style = readProperty(element, "style");
  const direct = readProperty(style, property);
  if (typeof direct === "string" && direct.trim() !== "") return direct;

  const styleText = attributeOf(element, "style");
  return styleText === null ? null : inlineDeclaration(styleText, property);
}

function styleValue(style: unknown, property: string): string | null {
  const direct = readProperty(style, property);
  if (typeof direct === "string" && direct.trim() !== "") return direct;

  const getPropertyValue = readProperty(style, "getPropertyValue");
  if (typeof getPropertyValue !== "function") return null;
  try {
    const value = (getPropertyValue as (name: string) => unknown).call(style, property);
    return typeof value === "string" && value.trim() !== "" ? value : null;
  } catch {
    return null;
  }
}

function computedStyleOf(element: ElementLike): VisibilityStyle | null {
  const ownerDocument = readProperty(element, "ownerDocument");
  const view = readProperty(ownerDocument, "defaultView");
  const getComputedStyle = readProperty(view, "getComputedStyle");
  if (typeof getComputedStyle !== "function") return null;

  let style: unknown;
  try {
    style = (getComputedStyle as (target: unknown) => unknown).call(view, element);
  } catch {
    return null;
  }
  const display = styleValue(style, "display");
  const visibility = styleValue(style, "visibility");
  const opacity = styleValue(style, "opacity");
  if (display === null || visibility === null || opacity === null) return null;
  return { display, visibility, opacity };
}

function isZeroOpacity(value: string): boolean {
  const number = Number(normalizeCssValue(value));
  return Number.isFinite(number) && number === 0;
}

function isKnownDisplay(value: string): boolean {
  const display = normalizeCssValue(value);
  return display !== "" && display.split(/\s+/).every((token) => DISPLAY_TOKENS.has(token));
}

function opacityVisibility(value: string): StyleVisibility {
  const number = Number(normalizeCssValue(value));
  if (!Number.isFinite(number) || number < 0 || number > 1) return "unknown";
  return number === 0 ? "hidden" : "visible";
}

function styleVisibility(style: VisibilityStyle): StyleVisibility {
  const display = normalizeCssValue(style.display);
  const visibility = normalizeCssValue(style.visibility);
  if (display === "none" || visibility === "hidden" || visibility === "collapse") {
    return "hidden";
  }
  if (!isKnownDisplay(display) || visibility !== "visible") return "unknown";
  return opacityVisibility(style.opacity);
}

function inlineStyleVisibility(element: ElementLike): StyleVisibility {
  const display = inlineStyleValue(element, "display");
  const visibility = inlineStyleValue(element, "visibility");
  const opacity = inlineStyleValue(element, "opacity");
  if (
    (display !== null && normalizeCssValue(display) === "none") ||
    (visibility !== null && ["hidden", "collapse"].includes(normalizeCssValue(visibility))) ||
    (opacity !== null && isZeroOpacity(opacity))
  ) {
    return "hidden";
  }
  if (display !== null && !isKnownDisplay(display)) return "unknown";
  if (visibility !== null && normalizeCssValue(visibility) !== "visible") return "unknown";
  if (opacity !== null && opacityVisibility(opacity) === "unknown") return "unknown";
  return "visible";
}

function isSelfVisible(element: ElementLike): boolean {
  const hiddenProperty = readProperty(element, "hidden");
  if (hiddenProperty === true || hasAttribute(element, "hidden")) return false;

  const ariaHidden = attributeOf(element, "aria-hidden");
  if (ariaHidden !== null && normalizeCssValue(ariaHidden) === "true") return false;

  // A real Element and MockElement both expose at least one attribute API.
  // Without it, hidden state is unknown and must not be treated as visible.
  const hasAttributeApi =
    typeof readProperty(element, "getAttribute") === "function" ||
    typeof readProperty(element, "hasAttribute") === "function";
  if (!hasAttributeApi) return false;

  if (inlineStyleVisibility(element) !== "visible") return false;
  const computed = computedStyleOf(element);
  return computed !== null && styleVisibility(computed) === "visible";
}

function parentOf(element: ElementLike): ParentResult {
  if (propertyExists(element, "parentElement")) {
    const parent = readProperty(element, "parentElement");
    if (parent === null) return { known: true, value: null };
    return isElementLike(parent)
      ? { known: true, value: parent }
      : { known: false, value: null };
  }
  if (propertyExists(element, "parentNode")) {
    const parent = readProperty(element, "parentNode");
    if (parent === null) return { known: true, value: null };
    return isElementLike(parent)
      ? { known: true, value: parent }
      : { known: true, value: null };
  }
  return { known: false, value: null };
}

function parentNodeOf(node: TextNodeLike): ElementLike | null {
  const parent = propertyExists(node, "parentNode")
    ? readProperty(node, "parentNode")
    : readProperty(node, "parent");
  return isElementLike(parent) ? parent : null;
}

/**
 * Return true only when the element and every known ancestor are visible.
 * Missing computed-style information is an unknown state and therefore
 * fails closed.
 */
export function isVisible(element: unknown): boolean {
  if (!isElementLike(element)) return false;

  const visited = new Set<unknown>();
  let current: ElementLike | null = element;
  while (current !== null) {
    if (visited.has(current)) return false;
    visited.add(current);
    if (!isSelfVisible(current)) return false;

    const parent = parentOf(current);
    if (!parent.known) return false;
    current = parent.value;
  }
  return true;
}

function collectVisibleText(element: ElementLike, visited: Set<unknown>): string {
  if (visited.has(element)) return "";
  visited.add(element);

  const childNodes = readProperty(element, "childNodes");
  if (!isRecord(childNodes) && !Array.isArray(childNodes)) return "";

  let text = "";
  for (const child of Array.from(childNodes as ArrayLike<unknown>)) {
    if (isTextNodeLike(child)) {
      text += textContentOf(child);
    } else if (isElementLike(child) && isVisible(child)) {
      text += collectVisibleText(child, visited);
    }
  }
  return text;
}

/**
 * Concatenate text nodes that belong to visible elements only. Hidden
 * descendants are pruned before their text can reach the result.
 */
export function visibleTextOf(node: unknown): string {
  if (isTextNodeLike(node)) {
    const parent = parentNodeOf(node);
    return parent !== null && isVisible(parent) ? textContentOf(node) : "";
  }
  if (!isElementLike(node) || !isVisible(node)) return "";
  return collectVisibleText(node, new Set<unknown>());
}
