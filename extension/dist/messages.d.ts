/** Namespace for extension ↔ service worker messages (D3, T-ADMIN-* extends below). */
export declare const MSG_NAMESPACE: "adp:";
export declare const MSG_ADMIN_NAMESPACE: "adp:admin:";
export declare const MSG_LOOKUP = "adp:lookup";
export declare const MSG_SYNC = "adp:sync-dlsite";
export declare const MSG_SERVER_STATUS = "adp:server-status";
export declare function isAdpMessage(type: unknown): type is string;
export declare function isAdminMessage(type: unknown): type is string;
//# sourceMappingURL=messages.d.ts.map