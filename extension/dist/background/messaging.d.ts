import { type ServerLookupItem } from "./server-client.js";
import { type FullSyncOutcome } from "../alarms.js";
import { MSG_LOOKUP, MSG_SYNC } from "../messages.js";
export type MessageHandler = (message: {
    type?: string;
}, sendResponse: (reply: unknown) => void) => boolean;
/** Register handlers for T-ADMIN-* without editing core messaging (scope-delta §4.2). */
export declare function registerMessageHandler(handler: MessageHandler): void;
export interface LookupMessage {
    type: typeof MSG_LOOKUP;
    items: ServerLookupItem[];
}
export interface LookupReply {
    ok: boolean;
    results?: Array<{
        owned: boolean;
        other: Array<{
            source: string;
            cid: string;
            title: string;
            url: string;
        }>;
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
export declare function handleLookup(items: ServerLookupItem[]): Promise<LookupReply>;
export declare function registerMessaging(): void;
export declare function updateDisconnectedBadge(): Promise<void>;
//# sourceMappingURL=messaging.d.ts.map