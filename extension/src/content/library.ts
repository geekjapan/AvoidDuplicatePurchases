import type { LibrarySource } from "@adp/shared";
import {
  MSG_LIBRARY_READ_PAGE,
  type LibraryPageReply,
  type LibraryReadPageMessage,
} from "../messages.js";
import { amazonLibraryPageReader } from "./amazon-library.js";
import { ebookjapanLibraryPageReader } from "./ebookjapan-library.js";
import { koboLibraryPageReader } from "./kobo-library.js";

/** Maximum items per visible batch; must match the server's 100-item cap. */
export const LIBRARY_BATCH_MAX = 100;

/**
 * Provider reader seam of the DOM library-sync protocol. Provider tasks
 * (issue #43/#44/#46 implementers) register one reader per source; the
 * foundation ships no provider selectors or state mapping.
 */
export interface LibraryPageReader {
  source: LibrarySource;
  /**
   * URL gate evaluated before any DOM read. Returning false means the tab
   * left the provider's library page (sign-in redirect, wrong page, …),
   * which the protocol reports as `login`.
   */
  matchesLibraryUrl(url: string): boolean;
  /**
   * Classify the visible DOM state (login / page_not_ready / empty / ready)
   * and read the visible batch. Called only when matchesLibraryUrl is true.
   * The concrete DOM shape is provider-specific; cast `doc` inside the reader.
   */
  readPage(doc: unknown, url: string): LibraryPageReply;
}

const readers = new Map<LibrarySource, LibraryPageReader>();

/** Register a provider reader; returns an unregister function (tests). */
export function registerLibraryPageReader(reader: LibraryPageReader): () => void {
  readers.set(reader.source, reader);
  return () => {
    if (readers.get(reader.source) === reader) readers.delete(reader.source);
  };
}

/**
 * Generic next-page guard (selector-free): absolute https, same host as the
 * current page, no credentials. Anything else — private network, http, cross
 * site, or malformed URLs — is rejected so the sync never leaves the visible
 * provider DOM.
 */
export function safeNextPageUrl(
  nextPageUrl: string | null,
  pageUrl: string,
): string | null {
  if (!nextPageUrl) return null;
  try {
    const next = new URL(nextPageUrl);
    const current = new URL(pageUrl);
    if (next.protocol !== "https:") return null;
    if (next.hostname !== current.hostname) return null;
    if (next.username !== "" || next.password !== "") return null;
    if (next.port !== "") return null;
    return next.href;
  } catch {
    return null;
  }
}

/**
 * Login / gate-failure response URL surface: never echo query, hash, or
 * credentials (transient OAuth codes, tracking params, …). HTTPS origin +
 * pathname only; anything else becomes an empty string.
 */
export function safeLoginPageUrl(pageUrl: string): string {
  try {
    const url = new URL(pageUrl);
    if (url.protocol !== "https:") return "";
    if (url.username !== "" || url.password !== "") return "";
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

/**
 * Generic content-side dispatch: resolve the registered reader, apply the
 * URL gate, and bound the batch. Item states pass through untouched —
 * unknown/non-owned states are never collapsed into owned here.
 */
export function handleLibraryReadPage(
  source: unknown,
  doc: unknown,
  pageUrl: string,
): LibraryPageReply {
  const reader = readers.get(source as LibrarySource);
  if (!reader) return { ok: false, error: "library_reader_unregistered" };
  if (!reader.matchesLibraryUrl(pageUrl)) {
    return { ok: true, state: "login", pageUrl: safeLoginPageUrl(pageUrl) };
  }
  const reply = reader.readPage(doc, pageUrl);
  if (!reply.ok) return reply;
  if (reply.state === "login") {
    return { ok: true, state: "login", pageUrl: safeLoginPageUrl(reply.pageUrl) };
  }
  if (reply.state === "page_not_ready") return reply;
  if (reply.items.length > LIBRARY_BATCH_MAX) {
    return { ok: false, error: "library_batch_too_large" };
  }
  return {
    ...reply,
    nextPageUrl: safeNextPageUrl(reply.nextPageUrl, pageUrl),
  };
}

if (typeof chrome !== "undefined" && typeof document !== "undefined") {
  registerLibraryPageReader(amazonLibraryPageReader);
  registerLibraryPageReader(ebookjapanLibraryPageReader);
  registerLibraryPageReader(koboLibraryPageReader);
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== MSG_LIBRARY_READ_PAGE) return false;
    const source = (message as LibraryReadPageMessage).source;
    sendResponse(handleLibraryReadPage(source, document, location.href));
    return false;
  });
}
