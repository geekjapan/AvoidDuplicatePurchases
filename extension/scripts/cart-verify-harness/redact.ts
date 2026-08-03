import type { CartRequest } from "@adp/shared";

const SENSITIVE_KEYS = new Set([
  "_token",
  "product_id",
  "product_ids",
  "item_id",
  "own_url",
]);

/** Redact request for safe console/evidence output — no cid, token, or URL paths with ids. */
export function redactRequest(req: CartRequest): {
  method: string;
  host: string;
  pathPattern: string;
  bodyShape: string | null;
} {
  const url = new URL(req.url);
  let pathPattern = url.pathname;

  // Replace cid-like segments in path with placeholders.
  pathPattern = pathPattern.replace(
    /product_id\/[^/]+/g,
    "product_id/<REDACTED>",
  );

  let bodyShape: string | null = null;
  if (req.body) {
    const parsed = JSON.parse(req.body) as Record<string, unknown>;
    bodyShape = JSON.stringify(redactBody(parsed));
  }

  return {
    method: req.method,
    host: url.host,
    pathPattern,
    bodyShape,
  };
}

function redactBody(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactBody);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(key)) {
        out[key] = key === "product_ids" || key === "items" ? "<REDACTED_ARRAY>" : "<REDACTED>";
      } else {
        out[key] = redactBody(val);
      }
    }
    return out;
  }
  return value;
}
