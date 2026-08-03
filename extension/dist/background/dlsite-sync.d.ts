import { getDlsiteSyncState, importDlsiteOnServer, commitDlsiteCursorOnServer, rematchOnServer, type ImportCounts } from "./server-client.js";
/** Daily chrome.alarms name for automatic DLsite sync (spec §4). */
export declare const DAILY_SYNC_ALARM = "adp-daily-sync";
/** Chunk size for POST /api/import/dlsite to keep MV3 worker lifetime safe. */
export declare const IMPORT_CHUNK_SIZE = 40;
export interface SyncOutcome {
    ok: boolean;
    counts?: ImportCounts;
    error?: string;
    fetched?: number;
}
export interface SyncDeps {
    getDlsiteSyncState: typeof getDlsiteSyncState;
    fetchDlsiteSales: typeof fetchDlsiteSales;
    importDlsiteOnServer: typeof importDlsiteOnServer;
    commitDlsiteCursorOnServer: typeof commitDlsiteCursorOnServer;
    rematchOnServer: typeof rematchOnServer;
}
/** Fetch DLsite sales history via authenticated browser session. */
export declare function fetchDlsiteSales(last?: string): Promise<{
    ok: true;
    sales: unknown[];
} | {
    ok: false;
    error: string;
}>;
/** Split a sales array into fixed-size import chunks. */
export declare function chunkSales<T>(sales: readonly T[], chunkSize?: number): T[][];
/**
 * Best-effort max sales_date across raw sales rows for the single post-sync cursor commit.
 * Delegates to shared maxSalesCursor (instant/time comparison, original winning string).
 */
export declare function maxCursorFromSales(sales: readonly unknown[]): string | null;
/**
 * Alarm listener entrypoint used by the service worker.
 * Must be called via a static import path (MV3 forbids dynamic import() in SW).
 * Never leaves an unhandled rejection on the alarm callback.
 */
export declare function handleDailySyncAlarm(alarm: {
    name: string;
}, sync?: typeof runDlsiteSync): void;
/** Full manual sync: fetch sales → chunked import (no mid-sync cursor) → one cursor commit → rematch. */
export declare function runDlsiteSync(deps?: Partial<SyncDeps>): Promise<SyncOutcome>;
//# sourceMappingURL=dlsite-sync.d.ts.map