import { runDlsiteSync, DAILY_SYNC_ALARM, type SyncOutcome } from "./background/dlsite-sync.js";
import { rematchOnServer } from "./background/server-client.js";
import { runAllFanzaSyncs, type SourceSyncOutcome } from "./adapters/fanza/sync.js";
export { DAILY_SYNC_ALARM };
export interface FullSyncOutcome {
    ok: boolean;
    sources: Record<string, SourceSyncOutcome | SyncOutcome>;
    error?: string;
}
export interface FullSyncDeps {
    runDlsite?: typeof runDlsiteSync;
    runFanza?: typeof runAllFanzaSyncs;
    rematch?: typeof rematchOnServer;
}
/** Manual + daily sync: DLsite then FANZA sources sequentially; one rematch at end. */
export declare function runFullSync(deps?: FullSyncDeps): Promise<FullSyncOutcome>;
/**
 * Alarm listener entrypoint. Static import only (MV3 service worker).
 * Never leaves an unhandled rejection on the alarm callback.
 */
export declare function handleDailySyncAlarm(alarm: {
    name: string;
}, sync?: typeof runFullSync): void;
export declare function registerAlarms(): void;
export declare const SYNC_SOURCE_LABELS: Record<string, string>;
export declare function listSyncSources(): readonly string[];
//# sourceMappingURL=alarms.d.ts.map