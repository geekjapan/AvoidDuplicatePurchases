import {
  DiscoveryProductReplySchema,
  DiscoverySearchReplySchema,
  DiscoverySelectMessageSchema,
  DiscoveryStartMessageSchema,
  MSG_DISCOVERY_READ_PRODUCT,
  MSG_DISCOVERY_READ_SEARCH,
  MSG_DISCOVERY_RESULT,
  MSG_DISCOVERY_STATUS,
  type DiscoveryCandidate,
  type DiscoveryFailureCode,
  type DiscoveryPriceTiers,
  type DiscoveryProductReply,
  type DiscoveryResultMessage,
  type DiscoverySearchReply,
  type DiscoverySelectMessage,
  type DiscoverySource,
  type DiscoveryStartMessage,
  type DiscoveryStartReply,
  type DiscoverySelectReply,
} from "../messages.js";
import { scoreDiscoveryCandidates } from "../content/discovery/identity.js";
import {
  buildDiscoverySearchUrls,
  counterpartSource,
} from "../content/discovery/search-url.js";
import { approvedStoreHttpsUrl } from "../content/banner.js";

export const DEFAULT_POLL_INTERVAL_MS = 500;
export const DEFAULT_READINESS_TIMEOUT_MS = 30000;
/** awaiting_selection sessions expire after this TTL (resource hygiene). */
export const AWAITING_SELECTION_TTL_MS = 5 * 60 * 1000;

type AllowedCandidate = {
  cid: string;
  productUrl: string;
  targetSource: DiscoverySource;
  title: string;
  maker: string | null;
  rank: number;
};

type SessionRecord = {
  sessionId: string;
  originTabId: number;
  source: DiscoverySource;
  targetSource: DiscoverySource;
  originTitle: string;
  originMaker: string | null;
  originTiers: DiscoveryPriceTiers;
  /** Tabs opened by this session; closed on finish. Never includes origin. */
  tempTabIds: Set<number>;
  phase: "search" | "awaiting_selection" | "product" | "done";
  /** Candidates shown to the user for this session; select must match one. */
  allowedCandidates: AllowedCandidate[];
  awaitingSelectionExpiresAt: number | null;
  expiryTimer: ReturnType<typeof setTimeout> | null;
};

export type DiscoveryDeps = {
  createTempTab?: (url: string) => Promise<number | null>;
  navigateTab?: (tabId: number, url: string) => Promise<void>;
  activateTab?: (tabId: number) => Promise<void>;
  closeTab?: (tabId: number) => Promise<void>;
  readSearch?: (
    tabId: number,
    targetSource: DiscoverySource,
  ) => Promise<DiscoverySearchReply | null>;
  readProduct?: (
    tabId: number,
    targetSource: DiscoverySource,
    expectedCid: string,
  ) => Promise<DiscoveryProductReply | null>;
  notifyOrigin?: (tabId: number, message: unknown) => Promise<void>;
  pollIntervalMs?: number;
  readinessTimeoutMs?: number;
  /** Test override for awaiting_selection TTL. */
  awaitingSelectionTtlMs?: number;
  /** Test override for setTimeout-based expiry scheduling. */
  scheduleExpiry?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearExpiry?: (handle: ReturnType<typeof setTimeout>) => void;
};

const sessions = new Map<string, SessionRecord>();
let tabLifecycleInstalled = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearExpiryTimer(session: SessionRecord, deps: DiscoveryDeps): void {
  if (session.expiryTimer !== null) {
    const clear = deps.clearExpiry ?? clearTimeout;
    clear(session.expiryTimer);
    session.expiryTimer = null;
  }
}

/**
 * Always create a dedicated user-visible tab — never hijack an existing tab.
 * DLsite defers its result cards in inactive tabs, so the user-triggered
 * comparison must activate the temporary tab until observation completes.
 */
export async function createTempTab(url: string): Promise<number | null> {
  try {
    const created = await chrome.tabs.create({ url, active: true });
    return created.id ?? null;
  } catch {
    return null;
  }
}

async function navigateTab(tabId: number, url: string): Promise<void> {
  await chrome.tabs.update(tabId, { url });
}

async function activateTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.update(tabId, { active: true });
  } catch {
    // origin tab may have closed while discovery was running
  }
}

async function closeTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // already closed
  }
}

async function notifyOrigin(tabId: number, message: unknown): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // origin tab may be gone; fail soft for pushes
  }
}

async function readSearch(
  tabId: number,
  targetSource: DiscoverySource,
): Promise<DiscoverySearchReply | null> {
  try {
    const raw =
      (await chrome.tabs.sendMessage(tabId, {
        type: MSG_DISCOVERY_READ_SEARCH,
        targetSource,
      })) ?? null;
    if (raw === null) return null;
    const parsed = DiscoverySearchReplySchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: "discovery_read_failed" };
    return parsed.data;
  } catch {
    return null;
  }
}

async function readProduct(
  tabId: number,
  targetSource: DiscoverySource,
  expectedCid: string,
): Promise<DiscoveryProductReply | null> {
  try {
    const raw =
      (await chrome.tabs.sendMessage(tabId, {
        type: MSG_DISCOVERY_READ_PRODUCT,
        targetSource,
        expectedCid,
      })) ?? null;
    if (raw === null) return null;
    const parsed = DiscoveryProductReplySchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: "discovery_read_failed" };
    return parsed.data;
  } catch {
    return null;
  }
}

async function waitForSearch(
  tabId: number,
  targetSource: DiscoverySource,
  deps: DiscoveryDeps,
  previousPageUrl?: string,
): Promise<DiscoverySearchReply | null> {
  const read = deps.readSearch ?? readSearch;
  const poll = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeout = deps.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
  const deadline = Date.now() + timeout;
  let last: DiscoverySearchReply | null = null;
  while (Date.now() < deadline) {
    last = await read(tabId, targetSource);
    if (last !== null && !last.ok) return last;
    if (
      last?.ok &&
      previousPageUrl !== undefined &&
      sameSearchPage(last.pageUrl, previousPageUrl)
    ) {
      last = null;
      await sleep(poll);
      continue;
    }
    if (last && last.ok && last.state !== "page_not_ready") return last;
    await sleep(poll);
  }
  return last;
}

function sameSearchPage(actual: string, expected: string): boolean {
  try {
    const left = new URL(actual);
    const right = new URL(expected);
    return (
      left.protocol === right.protocol &&
      left.hostname === right.hostname &&
      left.port === right.port &&
      left.pathname === right.pathname &&
      left.search === right.search
    );
  } catch {
    return false;
  }
}

async function waitForProduct(
  tabId: number,
  targetSource: DiscoverySource,
  expectedCid: string,
  deps: DiscoveryDeps,
): Promise<DiscoveryProductReply | null> {
  const read = deps.readProduct ?? readProduct;
  const poll = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeout = deps.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
  const deadline = Date.now() + timeout;
  let last: DiscoveryProductReply | null = null;
  while (Date.now() < deadline) {
    last = await read(tabId, targetSource, expectedCid);
    if (last !== null && !last.ok) return last;
    if (last && last.ok && last.state !== "page_not_ready") return last;
    await sleep(poll);
  }
  return last;
}

async function cleanupSession(
  session: SessionRecord,
  deps: DiscoveryDeps,
): Promise<void> {
  clearExpiryTimer(session, deps);
  const closer = deps.closeTab ?? closeTab;
  for (const id of session.tempTabIds) {
    await closer(id);
  }
  const activate = deps.activateTab ?? activateTab;
  await activate(session.originTabId);
  session.tempTabIds.clear();
  sessions.delete(session.sessionId);
  session.phase = "done";
  session.allowedCandidates = [];
  session.awaitingSelectionExpiresAt = null;
}

async function fail(
  session: SessionRecord,
  code: DiscoveryFailureCode,
  deps: DiscoveryDeps,
  message?: string,
): Promise<void> {
  const notify = deps.notifyOrigin ?? notifyOrigin;
  const result: DiscoveryResultMessage = {
    type: MSG_DISCOVERY_RESULT,
    sessionId: session.sessionId,
    ok: false,
    failureCode: code,
    message,
  };
  await notify(session.originTabId, result);
  await notify(session.originTabId, {
    type: MSG_DISCOVERY_STATUS,
    sessionId: session.sessionId,
    phase: "failed",
    failureCode: code,
    message,
  });
  await cleanupSession(session, deps);
}

function scheduleAwaitingSelectionExpiry(
  session: SessionRecord,
  deps: DiscoveryDeps,
): void {
  clearExpiryTimer(session, deps);
  const ttl = deps.awaitingSelectionTtlMs ?? AWAITING_SELECTION_TTL_MS;
  session.awaitingSelectionExpiresAt = Date.now() + ttl;
  const schedule = deps.scheduleExpiry ?? setTimeout;
  session.expiryTimer = schedule(() => {
    const current = sessions.get(session.sessionId);
    if (!current || current.phase !== "awaiting_selection") return;
    void fail(current, "discovery_cancelled", deps, "selection_timeout");
  }, ttl);
}

/**
 * Install once: when origin tab closes, drop related discovery sessions.
 * Safe to call repeatedly.
 */
export function ensureDiscoveryTabLifecycle(): void {
  if (tabLifecycleInstalled) return;
  tabLifecycleInstalled = true;
  if (typeof chrome === "undefined" || !chrome.tabs?.onRemoved?.addListener) return;
  chrome.tabs.onRemoved.addListener((tabId) => {
    for (const session of [...sessions.values()]) {
      if (session.originTabId === tabId) {
        // Origin gone — no notify path; just clean resources.
        void cleanupSession(session, {});
        continue;
      }
      if (session.tempTabIds.has(tabId)) {
        session.tempTabIds.delete(tabId);
      }
    }
  });
}

async function cancelSessionsForOriginTab(
  originTabId: number,
  exceptSessionId: string,
  deps: DiscoveryDeps,
): Promise<void> {
  for (const session of [...sessions.values()]) {
    if (session.originTabId !== originTabId) continue;
    if (session.sessionId === exceptSessionId) continue;
    await fail(session, "discovery_cancelled", deps, "superseded");
  }
}

function toAllowed(c: DiscoveryCandidate): AllowedCandidate | null {
  const safeUrl = approvedStoreHttpsUrl(c.productUrl, c.targetSource);
  if (!safeUrl) return null;
  return {
    cid: c.cid,
    productUrl: safeUrl,
    targetSource: c.targetSource,
    title: c.title,
    maker: c.maker,
    rank: c.rank,
  };
}

function mergeDiscoveryCandidates(
  byCid: Map<string, DiscoveryCandidate>,
  candidates: readonly DiscoveryCandidate[],
): void {
  for (const candidate of candidates) {
    const key = `${candidate.targetSource}:${candidate.cid}`;
    if (byCid.has(key)) continue;
    byCid.set(key, { ...candidate, rank: byCid.size + 1 });
  }
}

function findAllowed(
  session: SessionRecord,
  msg: { cid: string; productUrl: string; targetSource: DiscoverySource },
): AllowedCandidate | null {
  const safeUrl = approvedStoreHttpsUrl(msg.productUrl, msg.targetSource);
  if (!safeUrl) return null;
  if (msg.targetSource !== session.targetSource) return null;
  const cid = msg.cid.trim();
  for (const c of session.allowedCandidates) {
    if (
      c.targetSource === msg.targetSource &&
      c.cid === cid &&
      c.productUrl === safeUrl
    ) {
      return c;
    }
  }
  return null;
}

async function openProductAndCompare(
  session: SessionRecord,
  candidate: DiscoveryCandidate,
  deps: DiscoveryDeps,
): Promise<void> {
  const notify = deps.notifyOrigin ?? notifyOrigin;
  const create = deps.createTempTab ?? createTempTab;
  const navigate = deps.navigateTab ?? navigateTab;

  const safeUrl = approvedStoreHttpsUrl(candidate.productUrl, candidate.targetSource);
  if (!safeUrl) {
    await fail(session, "discovery_blocked_policy", deps);
    return;
  }

  clearExpiryTimer(session, deps);
  session.allowedCandidates = [];
  session.awaitingSelectionExpiresAt = null;

  await notify(session.originTabId, {
    type: MSG_DISCOVERY_STATUS,
    sessionId: session.sessionId,
    phase: "opening_product",
    message: "相手商品ページを開いています…",
  });

  session.phase = "product";
  // Prefer reusing the existing temp tab; else open a new one.
  const existingTabId = [...session.tempTabIds][0];
  let productTabId: number;
  if (existingTabId === undefined) {
    const createdId = await create(safeUrl);
    if (createdId === null || createdId === undefined) {
      await fail(session, "discovery_no_tab", deps);
      return;
    }
    productTabId = createdId;
    session.tempTabIds.add(productTabId);
  } else {
    productTabId = existingTabId;
    await navigate(productTabId, safeUrl);
  }

  await notify(session.originTabId, {
    type: MSG_DISCOVERY_STATUS,
    sessionId: session.sessionId,
    phase: "reading_prices",
    message: "相手商品の価格を読み取り中…",
  });

  const product = await waitForProduct(
    productTabId,
    candidate.targetSource,
    candidate.cid,
    deps,
  );

  if (!product) {
    await fail(session, "discovery_search_timeout", deps, "product_timeout");
    return;
  }
  if (!product.ok) {
    await fail(session, "discovery_receiver_not_ready", deps, product.error);
    return;
  }
  if (product.state === "login") {
    await fail(session, "discovery_login_required", deps);
    return;
  }
  if (product.state === "age_gate") {
    await fail(session, "discovery_age_gate", deps);
    return;
  }
  if (product.state === "mismatch") {
    await fail(session, "discovery_product_mismatch", deps);
    return;
  }
  if (product.state !== "ready") {
    await fail(session, "discovery_search_timeout", deps);
    return;
  }

  const result: DiscoveryResultMessage = {
    type: MSG_DISCOVERY_RESULT,
    sessionId: session.sessionId,
    ok: true,
    kind: "compare",
    targetSource: candidate.targetSource,
    targetCid: product.cid,
    targetTitle: product.title,
    targetMaker: product.maker,
    targetProductUrl: safeUrl,
    originTiers: session.originTiers,
    targetTiers: product.tiers,
  };
  await notify(session.originTabId, result);
  await notify(session.originTabId, {
    type: MSG_DISCOVERY_STATUS,
    sessionId: session.sessionId,
    phase: "done",
    message: "比較完了",
  });
  await cleanupSession(session, deps);
}

/**
 * Run discovery after user click: open temp search tab, score candidates,
 * auto-open product only on unique_exact, else return picker candidates.
 * Never posts price_observation. Never fetches store HTML via XHR.
 */
export async function runDiscoveryStart(
  message: DiscoveryStartMessage,
  originTabId: number,
  deps: DiscoveryDeps = {},
): Promise<DiscoveryStartReply> {
  ensureDiscoveryTabLifecycle();

  const parsed = DiscoveryStartMessageSchema.safeParse(message);
  if (!parsed.success) {
    return { ok: false, error: "discovery_invalid_request" };
  }
  const msg = parsed.data;
  if (!Number.isInteger(originTabId) || originTabId < 0) {
    return { ok: false, error: "discovery_invalid_request" };
  }

  // Drop any prior session with the same id (retry).
  const existing = sessions.get(msg.sessionId);
  if (existing) {
    await cleanupSession(existing, deps);
  }

  // One active discovery session per origin tab: cancel orphans from re-clicks.
  await cancelSessionsForOriginTab(originTabId, msg.sessionId, deps);

  const targetSource = counterpartSource(msg.source);
  const built = buildDiscoverySearchUrls(targetSource, msg.title);
  if (!built.ok) {
    return {
      ok: false,
      error: built.error === "url_too_long" ? "discovery_url_too_long" : "discovery_invalid_request",
    };
  }

  const session: SessionRecord = {
    sessionId: msg.sessionId,
    originTabId,
    source: msg.source,
    targetSource,
    originTitle: msg.title,
    originMaker: msg.maker,
    originTiers: msg.originTiers,
    tempTabIds: new Set(),
    phase: "search",
    allowedCandidates: [],
    awaitingSelectionExpiresAt: null,
    expiryTimer: null,
  };
  sessions.set(msg.sessionId, session);

  // Kick off orchestration without blocking the start reply longer than needed.
  void (async () => {
    const notify = deps.notifyOrigin ?? notifyOrigin;
    const create = deps.createTempTab ?? createTempTab;

    try {
      await notify(originTabId, {
        type: MSG_DISCOVERY_STATUS,
        sessionId: msg.sessionId,
        phase: "searching",
        message: "相手ストアを検索しています…",
      });

      const firstQuery = built.queries[0];
      if (!firstQuery) {
        await fail(session, "discovery_invalid_request", deps);
        return;
      }

      const tabId = await create(firstQuery.url);
      if (tabId === null) {
        await fail(session, "discovery_no_tab", deps);
        return;
      }
      session.tempTabIds.add(tabId);

      const navigate = deps.navigateTab ?? navigateTab;
      const searchDeadline = Date.now() + (deps.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS);
      const candidatesByCid = new Map<string, DiscoveryCandidate>();
      let pageNotReady = false;
      let previousSearchPageUrl: string | null = null;

      for (let queryIndex = 0; queryIndex < built.queries.length; queryIndex++) {
        const query = built.queries[queryIndex]!;
        if (queryIndex > 0) {
          const remaining = searchDeadline - Date.now();
          if (remaining <= 0) break;
          await navigate(tabId, query.url);
        }

        const remaining = Math.max(1, searchDeadline - Date.now());
        const search = await waitForSearch(
          tabId,
          targetSource,
          {
            ...deps,
            readinessTimeoutMs: remaining,
          },
          queryIndex > 0 ? previousSearchPageUrl ?? undefined : undefined,
        );
        if (!search) {
          pageNotReady = true;
          break;
        }
        if (!search.ok) {
          await fail(session, "discovery_receiver_not_ready", deps, search.error);
          return;
        }
        if (search.state === "login") {
          await fail(session, "discovery_login_required", deps);
          return;
        }
        if (search.state === "age_gate") {
          await fail(session, "discovery_age_gate", deps);
          return;
        }
        previousSearchPageUrl = search.pageUrl;
        if (search.state === "empty") {
          continue;
        }
        if (search.state === "page_not_ready") {
          pageNotReady = true;
          break;
        }
        if (search.state !== "ready") {
          pageNotReady = true;
          break;
        }

        mergeDiscoveryCandidates(candidatesByCid, search.candidates);

        // Stop early when a fallback already produced a strict exact match.
        const earlyScored = scoreDiscoveryCandidates(
          { title: session.originTitle, maker: session.originMaker },
          [...candidatesByCid.values()],
          10,
        );
        if (earlyScored.kind === "unique_exact") break;
      }

      if (pageNotReady) {
        await fail(session, "discovery_search_timeout", deps);
        return;
      }

      await notify(originTabId, {
        type: MSG_DISCOVERY_STATUS,
        sessionId: msg.sessionId,
        phase: "scoring",
        message: "候補を照合しています…",
      });

      const scored = scoreDiscoveryCandidates(
        { title: session.originTitle, maker: session.originMaker },
        [...candidatesByCid.values()],
        10,
      );

      if (scored.kind === "none") {
        await fail(session, "discovery_no_match", deps);
        return;
      }

      if (scored.kind === "unique_exact") {
        await openProductAndCompare(session, scored.candidate, deps);
        return;
      }

      // Ambiguous / non-exact: show picker; allow-list only these candidates.
      const allowed: AllowedCandidate[] = [];
      for (const c of scored.candidates) {
        const entry = toAllowed(c);
        if (entry) allowed.push(entry);
      }
      if (allowed.length === 0) {
        await fail(session, "discovery_no_match", deps);
        return;
      }

      session.phase = "awaiting_selection";
      session.allowedCandidates = allowed;
      scheduleAwaitingSelectionExpiry(session, deps);

      const result: DiscoveryResultMessage = {
        type: MSG_DISCOVERY_RESULT,
        sessionId: msg.sessionId,
        ok: true,
        kind: "candidates",
        targetSource,
        candidates: allowed.map((c) => ({
          targetSource: c.targetSource,
          cid: c.cid,
          title: c.title,
          maker: c.maker,
          productUrl: c.productUrl,
          rank: c.rank,
        })),
        originTiers: session.originTiers,
      };
      await notify(originTabId, result);
      await notify(originTabId, {
        type: MSG_DISCOVERY_STATUS,
        sessionId: msg.sessionId,
        phase: "awaiting_selection",
        message: "候補を選択してください",
      });
      // Close search tab now to avoid leaving clutter; product opens fresh.
      const closer = deps.closeTab ?? closeTab;
      for (const id of [...session.tempTabIds]) {
        await closer(id);
        session.tempTabIds.delete(id);
      }
      const activate = deps.activateTab ?? activateTab;
      await activate(originTabId);
    } catch (err) {
      await fail(session, "discovery_receiver_not_ready", deps, String(err));
    }
  })();

  return { ok: true, sessionId: msg.sessionId };
}

export async function runDiscoverySelect(
  message: DiscoverySelectMessage,
  originTabId: number,
  deps: DiscoveryDeps = {},
): Promise<DiscoverySelectReply> {
  ensureDiscoveryTabLifecycle();

  const parsed = DiscoverySelectMessageSchema.safeParse(message);
  if (!parsed.success) return { ok: false, error: "discovery_invalid_request" };
  const msg = parsed.data;

  const session = sessions.get(msg.sessionId);
  if (!session || session.originTabId !== originTabId) {
    return { ok: false, error: "discovery_session_lost" };
  }
  if (session.phase !== "awaiting_selection") {
    return { ok: false, error: "discovery_invalid_request" };
  }

  if (
    session.awaitingSelectionExpiresAt !== null &&
    Date.now() > session.awaitingSelectionExpiresAt
  ) {
    await fail(session, "discovery_cancelled", deps, "selection_timeout");
    return { ok: false, error: "discovery_session_lost" };
  }

  const allowed = findAllowed(session, msg);
  if (!allowed) {
    return { ok: false, error: "discovery_blocked_policy" };
  }

  const candidate: DiscoveryCandidate = {
    targetSource: allowed.targetSource,
    cid: allowed.cid,
    title: allowed.title,
    maker: allowed.maker,
    productUrl: allowed.productUrl,
    rank: allowed.rank,
  };

  void openProductAndCompare(session, candidate, deps);
  return { ok: true, sessionId: msg.sessionId };
}

/** Test helper: clear in-memory sessions and expiry timers. */
export function resetDiscoverySessionsForTests(): void {
  for (const session of sessions.values()) {
    if (session.expiryTimer !== null) clearTimeout(session.expiryTimer);
  }
  sessions.clear();
  tabLifecycleInstalled = false;
}

/** Test helper: inspect active session count. */
export function discoverySessionCountForTests(): number {
  return sessions.size;
}

/** Test helper: read allow-list size for a session. */
export function discoveryAllowedCountForTests(sessionId: string): number {
  return sessions.get(sessionId)?.allowedCandidates.length ?? 0;
}
