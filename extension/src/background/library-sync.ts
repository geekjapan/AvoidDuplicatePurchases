import {
  isCanonicalLibraryPageUrl,
  librarySyncProvider,
  type LibraryImportItem,
  type LibrarySource,
} from "@adp/shared";
import {
  LibraryPageReplySchema,
  MSG_LIBRARY_READ_PAGE,
  type LibraryPageReply,
  type LibraryReadPageMessage,
} from "../messages.js";
import {
  importLibraryBatchOnServer,
  markLibrarySourceSyncedOnServer,
  rematchOnServer,
  type LibraryImportCounts,
} from "./server-client.js";

export const DEFAULT_POLL_INTERVAL_MS = 500;
export const DEFAULT_READINESS_TIMEOUT_MS = 30000;
export const DEFAULT_MAX_PAGES = 100;

export interface LibrarySyncOutcome {
  ok: boolean;
  /** Null only when the message was rejected before a provider was selected. */
  source: LibrarySource | null;
  /** Fully read pages (ready/empty). */
  pages: number;
  observed: number;
  inserted: number;
  updated: number;
  error?: string;
}

export interface LibrarySyncDeps {
  getOrCreateTab?: (startUrl: string) => Promise<number | null>;
  navigateTab?: (tabId: number, url: string) => Promise<void>;
  readPage?: (tabId: number, source: LibrarySource) => Promise<LibraryPageReply | null>;
  importBatch?: (
    source: LibrarySource,
    pageUrl: string,
    items: LibraryImportItem[],
  ) => Promise<{ ok: true; counts: LibraryImportCounts } | { ok: false; error: string }>;
  rematch?: () => Promise<boolean>;
  markSynced?: (source: LibrarySource) => Promise<boolean>;
  pollIntervalMs?: number;
  readinessTimeoutMs?: number;
  maxPages?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reuse a tab already on the provider origin, else open the start URL. */
export async function getOrCreateTab(startUrl: string): Promise<number | null> {
  try {
    const origin = new URL(startUrl).origin;
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find((tab) => {
      if (typeof tab.id !== "number" || !tab.url) return false;
      try {
        return new URL(tab.url).origin === origin;
      } catch {
        return false;
      }
    });
    if (existing?.id !== undefined && existing.id !== null) return existing.id;
    const created = await chrome.tabs.create({ url: startUrl });
    return created.id ?? null;
  } catch {
    return null;
  }
}

async function navigateTab(tabId: number, url: string): Promise<void> {
  await chrome.tabs.update(tabId, { url });
}

async function readPage(
  tabId: number,
  source: LibrarySource,
): Promise<LibraryPageReply | null> {
  try {
    const message: LibraryReadPageMessage = { type: MSG_LIBRARY_READ_PAGE, source };
    const raw = (await chrome.tabs.sendMessage(tabId, message)) ?? null;
    if (raw === null) return null;
    const parsed = LibraryPageReplySchema.safeParse(raw);
    // Malformed ok:true/ok:false shapes fail closed immediately (no readiness poll).
    if (!parsed.success) {
      return { ok: false, error: "library_read_failed" };
    }
    return parsed.data;
  } catch {
    // Content script not (yet) present: tab loading or outside provider pages.
    return null;
  }
}

/**
 * Wait until the content script reports a decisive DOM state (login / empty /
 * ready). Transient `page_not_ready` and missing receivers are polled up to
 * the readiness timeout. A hard `ok:false` error returns immediately so the
 * caller does not burn the timeout on a permanent reader failure.
 */
async function waitForReadiness(
  tabId: number,
  source: LibrarySource,
  deps: LibrarySyncDeps,
  pollIntervalMs: number,
  readinessTimeoutMs: number,
): Promise<LibraryPageReply | null> {
  const read = deps.readPage ?? readPage;
  const deadline = Date.now() + readinessTimeoutMs;
  let last: LibraryPageReply | null = null;
  while (Date.now() < deadline) {
    last = await read(tabId, source);
    if (last !== null && !last.ok) return last;
    if (last && last.ok && last.state !== "page_not_ready") return last;
    await sleep(pollIntervalMs);
  }
  return last;
}

/**
 * Generic next-page guard: absolute https, same host, no credentials, and
 * not already visited. `visited` grows with every followed page, so any
 * cycle terminates. `empty` pages never paginate. Canonicality is enforced
 * by the caller before this guard runs (non-canonical next URLs fail the
 * run instead of silently stopping pagination).
 */
function nextPageUrl(
  reply: Extract<LibraryPageReply, { ok: true; state: "ready" | "empty" }>,
  pageUrl: string,
  visited: ReadonlySet<string>,
): string | null {
  const next = reply.nextPageUrl;
  if (!next || reply.state === "empty") return null;
  if (visited.has(next)) return null;
  try {
    const url = new URL(next);
    const current = new URL(pageUrl);
    if (url.protocol !== "https:" || url.hostname !== current.hostname) return null;
    if (url.username !== "" || url.password !== "") return null;
    if (url.port !== "") return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * User-initiated DOM library sync for one source (scope-delta 2026-08-08):
 * navigate to the provider start URL, wait for content-script readiness,
 * classify login / page-not-ready / empty / ready, import each visible batch
 * to the local server, follow visible next-page links with a visited-URL and
 * maximum-page guard, and rematch only after at least one successful batch.
 * Errors are local codes surfaced in the popup only; nothing is sent
 * outside the local server.
 */
export async function runLibrarySync(
  source: LibrarySource,
  deps: LibrarySyncDeps = {},
): Promise<LibrarySyncOutcome> {
  const provider = librarySyncProvider(source);
  const base: LibrarySyncOutcome = {
    ok: false,
    source,
    pages: 0,
    observed: 0,
    inserted: 0,
    updated: 0,
  };
  if (!provider) return { ...base, error: "library_unknown_provider" };

  const getTab = deps.getOrCreateTab ?? getOrCreateTab;
  const navigate = deps.navigateTab ?? navigateTab;
  const importBatch = deps.importBatch ?? importLibraryBatchOnServer;
  const rematch = deps.rematch ?? rematchOnServer;
  const markSynced = deps.markSynced ?? markLibrarySourceSyncedOnServer;
  const pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const readinessTimeoutMs = deps.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
  const maxPages = deps.maxPages ?? DEFAULT_MAX_PAGES;

  if (!Number.isSafeInteger(maxPages) || maxPages <= 0) {
    return { ...base, error: "library_max_pages_exceeded" };
  }
  if (
    !Number.isSafeInteger(pollIntervalMs) ||
    pollIntervalMs <= 0 ||
    !Number.isSafeInteger(readinessTimeoutMs) ||
    readinessTimeoutMs <= 0
  ) {
    return { ...base, error: "library_invalid_poll_config" };
  }

  const tabId = await getTab(provider.startUrl);
  if (tabId === null || tabId === undefined) return { ...base, error: "library_no_tab" };

  const visited = new Set<string>([provider.startUrl]);
  let pageUrl = provider.startUrl;
  const outcome: LibrarySyncOutcome = { ...base };
  let importedAny = false;

  for (let pageCount = 0; pageCount < maxPages; pageCount++) {
    await navigate(tabId, pageUrl);
    const reply = await waitForReadiness(
      tabId,
      source,
      deps,
      pollIntervalMs,
      readinessTimeoutMs,
    );
    if (reply === null) return { ...outcome, error: "library_read_failed" };
    if (!reply.ok) return { ...outcome, error: reply.error };
    if (reply.state === "login") return { ...outcome, error: "library_login_required" };
    if (reply.state === "page_not_ready") {
      return { ...outcome, error: "library_readiness_timeout" };
    }

    // A ready/empty reply is only success when it reports the source-specific
    // canonical library URL. Wrong host, wrong path, or retained query/hash
    // values fail closed before the page is counted or imported.
    if (!isCanonicalLibraryPageUrl(source, reply.pageUrl)) {
      return { ...outcome, error: "library_page_url_invalid" };
    }
    if (reply.pageUrl !== pageUrl) {
      return { ...outcome, error: "library_page_url_invalid" };
    }

    outcome.pages++;
    if (reply.state === "ready" && reply.items.length > 0) {
      const imported = await importBatch(source, reply.pageUrl, reply.items);
      if (!imported.ok) return { ...outcome, error: imported.error };
      outcome.observed += reply.items.length;
      outcome.inserted += imported.counts.inserted;
      outcome.updated += imported.counts.updated;
      importedAny = true;
    }

    // Fail closed before any next-page URL is followed: a reply may only
    // continue through the source-specific canonical library URL. This also
    // keeps temporary query values (e.g. Kobo auth codes) from being
    // retained in navigation; readers normalize them away before replying.
    if (reply.nextPageUrl !== null && !isCanonicalLibraryPageUrl(source, reply.nextPageUrl)) {
      return { ...outcome, error: "library_page_url_invalid" };
    }
    const next = nextPageUrl(reply, pageUrl, visited);
    if (!next) break;
    if (outcome.pages >= maxPages) {
      return { ...outcome, error: "library_max_pages_exceeded" };
    }
    visited.add(next);
    pageUrl = next;
  }

  if (importedAny) {
    try {
      if (!(await rematch())) {
        return { ...outcome, error: "library_rematch_failed" };
      }
    } catch {
      return { ...outcome, error: "library_rematch_failed" };
    }
  }
  if (outcome.pages > 0) {
    try {
      if (!(await markSynced(source))) {
        return { ...outcome, error: "library_mark_synced_failed" };
      }
    } catch {
      return { ...outcome, error: "library_mark_synced_failed" };
    }
  }
  return { ...outcome, ok: true };
}
