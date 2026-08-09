import {
  LIBRARY_SOURCES,
  PriceObservationRequestSchema,
  type LibrarySource,
} from "@adp/shared";
import {
  lookupOnServer,
  postPriceObservationOnServer,
  type ServerLookupItem,
} from "./server-client.js";
import { runFullSync, type FullSyncOutcome } from "../alarms.js";
import { checkServerHealth } from "./server-client.js";
import { runAmazonManualSync, type AmazonSyncOutcome } from "./amazon-sync.js";
import { runLibrarySync, type LibrarySyncOutcome } from "./library-sync.js";
import {
  isAdminMessage,
  MSG_AMAZON_SYNC,
  MSG_LIBRARY_SYNC,
  MSG_LOOKUP,
  MSG_PRICE_OBSERVATION,
  MSG_SYNC,
  MSG_SERVER_STATUS,
  type PriceObservationMessage,
  type PriceObservationReply,
} from "../messages.js";

export type MessageHandler = (
  message: { type?: string },
  sendResponse: (reply: unknown) => void,
) => boolean;

const extraHandlers: MessageHandler[] = [];

/** Register handlers for T-ADMIN-* without editing core messaging (scope-delta §4.2). */
export function registerMessageHandler(handler: MessageHandler): void {
  extraHandlers.push(handler);
}

export interface LookupMessage {
  type: typeof MSG_LOOKUP;
  items: ServerLookupItem[];
}

export interface LookupReply {
  ok: boolean;
  results?: Array<{
    owned: boolean;
    other: Array<{ source: string; cid: string; title: string; url: string }>;
    possible?: Array<{ source: string; cid: string; title: string; url: string }>;
  }>;
}

export interface SyncMessage {
  type: typeof MSG_SYNC;
}

export interface SyncReply {
  ok: boolean;
  outcome?: FullSyncOutcome;
}

export interface ServerStatusReply {
  connected: boolean;
}

export interface AmazonSyncMessage {
  type: typeof MSG_AMAZON_SYNC;
}

export interface AmazonSyncReply {
  ok: boolean;
  outcome?: AmazonSyncOutcome;
}

export interface LibrarySyncMessage {
  type: typeof MSG_LIBRARY_SYNC;
  source: LibrarySource;
}

export interface LibrarySyncReply {
  ok: boolean;
  outcome?: LibrarySyncOutcome;
}

function isLibrarySource(source: unknown): source is LibrarySource {
  return (LIBRARY_SOURCES as readonly string[]).includes(source as string);
}

/**
 * Silent-failure lookup contract (D3): when server is down, return ok:false
 * without throwing so content scripts add no DOM.
 */
export async function handleLookup(items: ServerLookupItem[]): Promise<LookupReply> {
  const res = await lookupOnServer(items);
  if (!res.ok) return { ok: false };
  return { ok: true, results: res.results };
}

export function registerMessaging(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    for (const handler of extraHandlers) {
      if (handler(message, sendResponse)) return true;
    }
    if (isAdminMessage(message?.type)) {
      return false;
    }
    if (message?.type === MSG_LOOKUP) {
      handleLookup(message.items ?? [])
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false }));
      return true;
    }
    if (message?.type === MSG_SYNC) {
      runFullSync()
        .then((outcome) => sendResponse({ ok: outcome.ok, outcome }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            outcome: { ok: false, sources: {}, error: String(err) },
          }),
        );
      return true;
    }
    if (message?.type === MSG_AMAZON_SYNC) {
      runAmazonManualSync()
        .then((outcome) => sendResponse({ ok: outcome.ok, outcome }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            outcome: {
              ok: false,
              observed: 0,
              stored: 0,
              acquiredOrUnknown: 0,
              rentals: 0,
              error: String(err),
            },
          }),
        );
      return true;
    }
    if (message?.type === MSG_LIBRARY_SYNC) {
      const source = (message as LibrarySyncMessage).source;
      if (!isLibrarySource(source)) {
        sendResponse({
          ok: false,
          outcome: {
            ok: false,
            source: LIBRARY_SOURCES[0],
            pages: 0,
            observed: 0,
            inserted: 0,
            updated: 0,
            error: "library_unknown_provider",
          },
        });
        return true;
      }
      runLibrarySync(source)
        .then((outcome) => sendResponse({ ok: outcome.ok, outcome }))
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            outcome: {
              ok: false,
              source,
              pages: 0,
              observed: 0,
              inserted: 0,
              updated: 0,
              error: String(err),
            },
          }),
        );
      return true;
    }
    if (message?.type === MSG_PRICE_OBSERVATION) {
      const msg = message as Partial<PriceObservationMessage>;
      const parsed = PriceObservationRequestSchema.safeParse({
        source: msg.source,
        cid: msg.cid,
        pageUrl: msg.pageUrl,
        regular: msg.regular,
        sale: msg.sale,
        coupon: msg.coupon,
      });
      if (!parsed.success) {
        sendResponse({ ok: false, error: "invalid_price_observation" } satisfies PriceObservationReply);
        return true;
      }
      postPriceObservationOnServer(parsed.data)
        .then((res) => {
          const reply: PriceObservationReply = res.ok
            ? { ok: true }
            : { ok: false, error: res.error };
          sendResponse(reply);
        })
        .catch((err: unknown) =>
          sendResponse({ ok: false, error: String(err) } satisfies PriceObservationReply),
        );
      return true;
    }
    if (message?.type === MSG_SERVER_STATUS) {
      checkServerHealth()
        .then((connected) => sendResponse({ connected }))
        .catch(() => sendResponse({ connected: false }));
      return true;
    }
    return false;
  });
}

export async function updateDisconnectedBadge(): Promise<void> {
  const connected = await checkServerHealth();
  if (connected) {
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setBadgeBackgroundColor({ color: "#2e7d32" });
  } else {
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setBadgeBackgroundColor({ color: "#c62828" });
  }
}
