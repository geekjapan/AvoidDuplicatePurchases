import { lookupOnServer } from "./server-client.js";
import { runDlsiteSync } from "./dlsite-sync.js";
import { checkServerHealth } from "./server-client.js";
import { isAdminMessage, MSG_LOOKUP, MSG_SYNC, MSG_SERVER_STATUS } from "../messages.js";
const extraHandlers = [];
/** Register handlers for T-ADMIN-* without editing core messaging (scope-delta §4.2). */
export function registerMessageHandler(handler) {
    extraHandlers.push(handler);
}
/**
 * Silent-failure lookup contract (D3): when server is down, return ok:false
 * without throwing so content scripts add no DOM.
 */
export async function handleLookup(items) {
    const res = await lookupOnServer(items);
    if (!res.ok)
        return { ok: false };
    return { ok: true, results: res.results };
}
export function registerMessaging() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        for (const handler of extraHandlers) {
            if (handler(message, sendResponse))
                return true;
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
            runDlsiteSync()
                .then((outcome) => sendResponse({ ok: outcome.ok, outcome }))
                .catch((err) => sendResponse({
                ok: false,
                outcome: { ok: false, error: String(err) },
            }));
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
export async function updateDisconnectedBadge() {
    const connected = await checkServerHealth();
    if (connected) {
        await chrome.action.setBadgeText({ text: "" });
        await chrome.action.setBadgeBackgroundColor({ color: "#2e7d32" });
    }
    else {
        await chrome.action.setBadgeText({ text: "!" });
        await chrome.action.setBadgeBackgroundColor({ color: "#c62828" });
    }
}
//# sourceMappingURL=messaging.js.map