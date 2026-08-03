export declare const DEFAULT_SERVER_PORT = 41321;
export declare const SERVER_BASE = "http://127.0.0.1:41321";
export interface ServerLookupItem {
    source?: string;
    cid?: string;
    title?: string;
    maker?: string;
}
export interface LookupResult {
    owned: boolean;
    other: Array<{
        source: string;
        cid: string;
        title: string;
        url: string;
    }>;
}
export interface ImportCounts {
    inserted: number;
    updated: number;
}
export interface SyncState {
    cursor: string | null;
    lastSyncedAt: string | null;
}
export declare function serverFetch<T>(path: string, options?: RequestInit): Promise<{
    ok: true;
    data: T;
} | {
    ok: false;
    error: string;
}>;
export declare function checkServerHealth(): Promise<boolean>;
export declare function lookupOnServer(items: ServerLookupItem[]): Promise<{
    ok: true;
    results: LookupResult[];
} | {
    ok: false;
}>;
export declare function importDlsiteOnServer(payload: unknown): Promise<{
    ok: true;
    counts: ImportCounts;
} | {
    ok: false;
    error: string;
}>;
export declare function rematchOnServer(): Promise<boolean>;
export declare function getDlsiteSyncState(): Promise<SyncState | null>;
//# sourceMappingURL=server-client.d.ts.map