import { runDlsiteSync, DAILY_SYNC_ALARM, type SyncOutcome } from "./background/dlsite-sync.js";
import { rematchOnServer } from "./background/server-client.js";
import { runAllFanzaSyncs, type SourceSyncOutcome } from "./adapters/fanza/sync.js";
import {
  ALL_SYNC_SOURCES,
  persistFullSyncOutcomeOnServer,
  persistSyncOutcomeOnServer,
  type SyncSource,
} from "./adapters/fanza/server-api.js";

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
  persistOutcomes?: (outcome: FullSyncOutcome) => Promise<void>;
}

/** Successful or partially imported sources may already have persisted rows. */
export function anyImportsMayHavePersisted(
  sources: Record<string, SourceSyncOutcome | SyncOutcome>,
): boolean {
  return Object.values(sources).some((outcome) => {
    if (outcome.ok) return true;
    const inserted = outcome.counts?.inserted ?? 0;
    const updated = outcome.counts?.updated ?? 0;
    return inserted > 0 || updated > 0;
  });
}

/**
 * Prefer the first independent source error; if rematch also fails, keep both
 * in a deterministic combined form rather than dropping either.
 */
export function combineFullSyncError(
  sourceError: string | undefined,
  rematchFailed: boolean,
): string | undefined {
  if (sourceError && rematchFailed) return `${sourceError}+rematch_failed`;
  if (sourceError) return sourceError;
  if (rematchFailed) return "rematch_failed";
  return undefined;
}

async function persistLatestOutcomes(outcome: FullSyncOutcome): Promise<void> {
  // The Node test runner has no extension runtime; persistence is exercised through
  // the injected dependency and the server API tests instead.
  if (typeof chrome === "undefined") return;
  await Promise.all(
    Object.entries(outcome.sources).map(async ([source, sourceOutcome]) => {
      if (!(ALL_SYNC_SOURCES as readonly string[]).includes(source)) return;
      try {
        await persistSyncOutcomeOnServer(source as SyncSource, sourceOutcome);
      } catch {
        // A status write must not turn a completed store sync into a failed sync.
      }
    }),
  );
  try {
    await persistFullSyncOutcomeOnServer({
      ok: outcome.ok,
      error: outcome.error,
    });
  } catch {
    // Global outcome write is best-effort and must not alter sync success.
  }
}

async function executeFullSync(deps: FullSyncDeps): Promise<FullSyncOutcome> {
  const runDlsite = deps.runDlsite ?? runDlsiteSync;
  const runFanza = deps.runFanza ?? runAllFanzaSyncs;
  const rematch = deps.rematch ?? rematchOnServer;
  const persistOutcomes = deps.persistOutcomes ?? persistLatestOutcomes;
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

  // Rematch after every source attempt whenever any import may have persisted,
  // even if an independent source failed. Skip only when nothing could have landed.
  let rematchFailed = false;
  if (anyImportsMayHavePersisted(sources)) {
    const rematchOk = await rematch();
    rematchFailed = !rematchOk;
  }

  const error = combineFullSyncError(firstError, rematchFailed);
  const outcome: FullSyncOutcome =
    error === undefined ? { ok: true, sources } : { ok: false, sources, error };
  await persistOutcomes(outcome);
  return outcome;
}

let activeFullSync: Promise<FullSyncOutcome> | null = null;

/** Manual + daily sync: DLsite then FANZA sources sequentially; one rematch at end. */
export function runFullSync(deps: FullSyncDeps = {}): Promise<FullSyncOutcome> {
  if (activeFullSync) return activeFullSync;
  const run = executeFullSync(deps);
  activeFullSync = run.then(
    (outcome) => {
      activeFullSync = null;
      return outcome;
    },
    (error: unknown) => {
      activeFullSync = null;
      throw error;
    },
  );
  return activeFullSync;
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
