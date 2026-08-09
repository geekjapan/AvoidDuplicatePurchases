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
  buildDiscoverySearchUrl,
  counterpartSource,
} from "../content/discovery/search-url.js";
import { approvedStoreHttpsUrl } from "../content/banner.js";

export const DEFAULT_POLL_INTERVAL_MS = 500;
export const DEFAULT_READINESS_TIMEOUT_MS = 30000;

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
};

export type DiscoveryDeps = {
  createTempTab?: (url: string) => Promise<number | null>;
  navigateTab?: (tabId: number, url: string) => Promise<void>;
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
};

const sessions = new Map<string, SessionRecord>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Always create a new background tab — never hijack user tabs. */
export async function createTempTab(url: string): Promise<number | null> {
  try {
    const created = await chrome.tabs.create({ url, active: false });
    return created.id ?? null;
  } catch {
    return null;
  }
}

async function navigateTab(tabId: number, url: string): Promise<void> {
  await chrome.tabs.update(tabId, { url });
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
): Promise<DiscoverySearchReply | null> {
  const read = deps.readSearch ?? readSearch;
  const poll = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const timeout = deps.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
  const deadline = Date.now() + timeout;
  let last: DiscoverySearchReply | null = null;
  while (Date.now() < deadline) {
    last = await read(tabId, targetSource);
    if (last !== null && !last.ok) return last;
    if (last && last.ok && last.state !== "page_not_ready") return last;
    await sleep(poll);
  }
  return last;
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

async function cleanupSession(session: SessionRecord, deps: DiscoveryDeps): Promise<void> {
  const closer = deps.closeTab ?? closeTab;
  for (const id of session.tempTabIds) {
    await closer(id);
  }
  session.tempTabIds.clear();
  sessions.delete(session.sessionId);
  session.phase = "done";
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

  const targetSource = counterpartSource(msg.source);
  const built = buildDiscoverySearchUrl(targetSource, msg.title);
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

      const tabId = await create(built.url);
      if (tabId === null) {
        await fail(session, "discovery_no_tab", deps);
        return;
      }
      session.tempTabIds.add(tabId);

      const search = await waitForSearch(tabId, targetSource, deps);
      if (!search) {
        await fail(session, "discovery_search_timeout", deps);
        return;
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
      if (search.state === "empty") {
        await fail(session, "discovery_no_match", deps);
        return;
      }
      if (search.state !== "ready") {
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
        search.candidates,
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

      // Ambiguous / non-exact: show picker; keep session + temp tab until select/fail.
      session.phase = "awaiting_selection";
      const result: DiscoveryResultMessage = {
        type: MSG_DISCOVERY_RESULT,
        sessionId: msg.sessionId,
        ok: true,
        kind: "candidates",
        targetSource,
        candidates: scored.candidates,
        originTiers: session.originTiers,
      };
      await notify(originTabId, result);
      await notify(originTabId, {
        type: MSG_DISCOVERY_STATUS,
        sessionId: msg.sessionId,
        phase: "awaiting_selection",
        message: "候補を選択してください",
      });
      // Leave temp search tab open until user selects or session ends.
      // Close search tab now to avoid leaving clutter; product opens fresh.
      const closer = deps.closeTab ?? closeTab;
      for (const id of [...session.tempTabIds]) {
        await closer(id);
        session.tempTabIds.delete(id);
      }
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

  const safeUrl = approvedStoreHttpsUrl(msg.productUrl, msg.targetSource);
  if (!safeUrl) return { ok: false, error: "discovery_blocked_policy" };

  const candidate: DiscoveryCandidate = {
    targetSource: msg.targetSource,
    cid: msg.cid,
    title: msg.cid, // title re-read from product page
    maker: null,
    productUrl: safeUrl,
    rank: 1,
  };

  void openProductAndCompare(session, candidate, deps);
  return { ok: true, sessionId: msg.sessionId };
}

/** Test helper: clear in-memory sessions. */
export function resetDiscoverySessionsForTests(): void {
  sessions.clear();
}

/** Test helper: inspect active session count. */
export function discoverySessionCountForTests(): number {
  return sessions.size;
}
