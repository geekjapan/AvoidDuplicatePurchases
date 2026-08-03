import {
  getAllSyncStates,
  listSyncSources,
  type SyncStateWithOutcome,
} from "../adapters/fanza/server-api.js";
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
  state: SyncStateWithOutcome | null,
  outcome?: SourceSyncOutcome | SyncOutcome,
): string {
  const label = SYNC_SOURCE_LABELS[source] ?? source;
  const last = formatLastSynced(state?.lastSyncedAt ?? null);
  const latest = outcome ?? state?.latestOutcome;
  if (!latest) {
    return `${label}: 最終 ${last}`;
  }
  if (latest.ok && latest.counts) {
    const fetched = latest.fetched ?? "?";
    return `${label}: 取得 ${fetched} ページ / 新規 ${latest.counts.inserted} / 更新 ${latest.counts.updated}（${last}）`;
  }
  if (latest.error) {
    const counts = latest.counts
      ? ` / 新規 ${latest.counts.inserted} / 更新 ${latest.counts.updated}`
      : "";
    return `${label}: エラー ${latest.error}${counts}（${last}）`;
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
