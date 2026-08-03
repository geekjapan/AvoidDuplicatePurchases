import { runDlsiteSync, DAILY_SYNC_ALARM, type SyncOutcome } from "./background/dlsite-sync.js";
import { rematchOnServer } from "./background/server-client.js";
import { runAllFanzaSyncs, type SourceSyncOutcome } from "./adapters/fanza/sync.js";
import { ALL_SYNC_SOURCES } from "./adapters/fanza/server-api.js";

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
export async function runFullSync(deps: FullSyncDeps = {}): Promise<FullSyncOutcome> {
  const runDlsite = deps.runDlsite ?? runDlsiteSync;
  const runFanza = deps.runFanza ?? runAllFanzaSyncs;
  const rematch = deps.rematch ?? rematchOnServer;
  const sources: Record<string, SourceSyncOutcome | SyncOutcome> = {};
  let firstError: string | undefined;

  const dlsite = await runDlsite({
    rematchOnServer: async () => true,
  });
  sources.dlsite = dlsite;
  if (!dlsite.ok) {
    firstError = dlsite.error ?? "dlsite_failed";
  }

  const fanzaOutcomes = await runFanza();
  for (const [source, outcome] of Object.entries(fanzaOutcomes)) {
    sources[source] = outcome;
    if (!outcome.ok && firstError === undefined) {
      firstError = outcome.error ?? `${source}_failed`;
    }
  }

  if (firstError !== undefined) {
    return { ok: false, sources, error: firstError };
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
export function handleDailySyncAlarm(
  alarm: { name: string },
  sync: typeof runFullSync = runFullSync,
): void {
  if (alarm.name !== DAILY_SYNC_ALARM) return;
  void Promise.resolve(sync()).catch(() => {
    // Swallow so the service-worker alarm callback never surfaces unhandled rejection.
  });
}

export async function registerAlarms(): Promise<void> {
  chrome.alarms.onAlarm.addListener((alarm) => {
    handleDailySyncAlarm(alarm);
  });
  const existing = await chrome.alarms.get(DAILY_SYNC_ALARM);
  if (!existing) {
    chrome.alarms.create(DAILY_SYNC_ALARM, { periodInMinutes: 1440 });
  }
}

export const SYNC_SOURCE_LABELS: Record<string, string> = {
  dlsite: "DLsite",
  fanza_doujin: "FANZA 同人",
  fanza_books: "FANZA ブックス",
  fanza_video: "FANZA 動画",
  fanza_dlsoft: "FANZA PCゲーム",
};

export function listSyncSources(): readonly string[] {
  return ALL_SYNC_SOURCES;
}
