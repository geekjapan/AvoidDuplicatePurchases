import { visibleTextOf } from "../dom-visibility.js";

/**
 * Shared login / age-gate / page-url guards for discovery readers.
 * Keep a single fail-closed classification for product and search pages.
 */

export function safePageUrl(pageUrl: string): string {
  try {
    const url = new URL(pageUrl);
    if (url.protocol !== "https:") return "";
    if (url.username !== "" || url.password !== "") return "";
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

export function detectAgeGate(doc: Document, pageUrl: string): boolean {
  try {
    if (/age_check/i.test(new URL(pageUrl).pathname)) return true;
  } catch {
    // ignore malformed URL
  }
  const title = (doc.title ?? "").trim();
  if (/年齢認証|年齢確認/.test(title)) return true;
  const bodyText = doc.body ? visibleTextOf(doc.body).slice(0, 500) : "";
  return /このページはアダルト/.test(bodyText) && /年齢認証/.test(bodyText);
}

/**
 * Login detection is intentionally strict: path markers or store-titled login pages.
 * A bare "ログイン" in unrelated titles must not false-positive.
 */
export function detectLogin(doc: Document, pageUrl: string): boolean {
  try {
    const path = new URL(pageUrl).pathname;
    if (/\/login|\/my\/|=\/login\//i.test(path)) return true;
  } catch {
    // ignore malformed URL
  }
  const title = (doc.title ?? "").trim();
  return /ログイン/.test(title) && /DMM|FANZA|DLsite/i.test(title);
}
