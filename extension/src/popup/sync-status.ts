import type { SyncState } from "../background/server-client.js";
import { getAllSyncStates, listSyncSources } from "../adapters/fanza/server-api.js";
import { SYNC_SOURCE_LABELS, type FullSyncOutcome } from "../alarms.js";
import type { SourceSyncOutcome } from "../adapters/fanza/sync.js";
import type { SyncOutcome } from "../background/dlsite-sync.js";

function formatLastSynced(lastSyncedAt: string | null): string {
  if (!lastSyncedAt) return "未同期";
  try {
    return new Date(lastSyncedAt).toLocaleString("ja-JP");
  } catch {
    return lastSyncedAt;
  }
}

function formatOutcomeLine(
  source: string,
  state: SyncState | null,
  outcome?: SourceSyncOutcome | SyncOutcome,
): string {
  const label = SYNC_SOURCE_LABELS[source] ?? source;
  const last = formatLastSynced(state?.lastSyncedAt ?? null);
  if (!outcome) {
    return `${label}: 最終 ${last}`;
  }
  if (outcome.ok && outcome.counts) {
    const fetched = outcome.fetched ?? "?";
    return `${label}: 取得 ${fetched} ページ / 新規 ${outcome.counts.inserted} / 更新 ${outcome.counts.updated}（${last}）`;
  }
  if (outcome.error) {
    return `${label}: エラー ${outcome.error}（${last}）`;
  }
  return `${label}: 失敗（${last}）`;
}

/** Populate per-source sync status rows in the popup. */
export async function renderSyncStatus(
  container: HTMLElement,
  outcomes?: FullSyncOutcome["sources"],
): Promise<void> {
  const states = await getAllSyncStates();
  const lines: string[] = [];
  for (const source of listSyncSources()) {
    lines.push(formatOutcomeLine(source, states[source] ?? null, outcomes?.[source]));
  }
  container.textContent = lines.join("\n");
}

/** Refresh status without sync outcomes (last-synced only). */
export async function refreshSyncStatus(container: HTMLElement): Promise<void> {
  await renderSyncStatus(container);
}
