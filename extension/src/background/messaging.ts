import { lookupOnServer, type ServerLookupItem } from "./server-client.js";
import { runFullSync, type FullSyncOutcome } from "../alarms.js";
import { checkServerHealth } from "./server-client.js";
import { isAdminMessage, MSG_LOOKUP, MSG_SYNC, MSG_SERVER_STATUS } from "../messages.js";

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
