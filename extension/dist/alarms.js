import { runDlsiteSync, DAILY_SYNC_ALARM } from "./background/dlsite-sync.js";
import { rematchOnServer } from "./background/server-client.js";
import { runAllFanzaSyncs } from "./adapters/fanza/sync.js";
import { ALL_SYNC_SOURCES } from "./adapters/fanza/server-api.js";
export { DAILY_SYNC_ALARM };
/** Manual + daily sync: DLsite then FANZA sources sequentially; one rematch at end. */
export async function runFullSync(deps = {}) {
    const runDlsite = deps.runDlsite ?? runDlsiteSync;
    const runFanza = deps.runFanza ?? runAllFanzaSyncs;
    const rematch = deps.rematch ?? rematchOnServer;
    const sources = {};
    const dlsite = await runDlsite({
        rematchOnServer: async () => true,
    });
    sources.dlsite = dlsite;
    if (!dlsite.ok) {
        return { ok: false, sources, error: dlsite.error };
    }
    const fanzaOutcomes = await runFanza();
    for (const [source, outcome] of Object.entries(fanzaOutcomes)) {
        sources[source] = outcome;
        if (!outcome.ok) {
            return { ok: false, sources, error: outcome.error };
        }
    }
    const rematchOk = await rematch();
    if (!rematchOk) {
        return { ok: false, sources, error: "rematch_failed" };
    }
    return { ok: true, sources };
}
/**
 * Alarm listener entrypoint. Static import only (MV3 service worker).
 * Never leaves an unhandled rejection on the alarm callback.
 */
export function handleDailySyncAlarm(alarm, sync = runFullSync) {
    if (alarm.name !== DAILY_SYNC_ALARM)
        return;
    void Promise.resolve(sync()).catch(() => {
        // Swallow so the service-worker alarm callback never surfaces unhandled rejection.
    });
}
export function registerAlarms() {
    chrome.alarms.create(DAILY_SYNC_ALARM, { periodInMinutes: 1440 });
    chrome.alarms.onAlarm.addListener((alarm) => {
        handleDailySyncAlarm(alarm);
    });
}
export const SYNC_SOURCE_LABELS = {
    dlsite: "DLsite",
    fanza_doujin: "FANZA 同人",
    fanza_books: "FANZA ブックス",
    fanza_video: "FANZA 動画",
    fanza_dlsoft: "FANZA PCゲーム",
};
export function listSyncSources() {
    return ALL_SYNC_SOURCES;
}
//# sourceMappingURL=alarms.js.map