import { getAllSyncStates, listSyncSources } from "../adapters/fanza/server-api.js";
import { SYNC_SOURCE_LABELS } from "../alarms.js";
function formatLastSynced(lastSyncedAt) {
    if (!lastSyncedAt)
        return "未同期";
    try {
        return new Date(lastSyncedAt).toLocaleString("ja-JP");
    }
    catch {
        return lastSyncedAt;
    }
}
function formatOutcomeLine(source, state, outcome) {
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
export async function renderSyncStatus(container, outcomes) {
    const states = await getAllSyncStates();
    const lines = [];
    for (const source of listSyncSources()) {
        lines.push(formatOutcomeLine(source, states[source] ?? null, outcomes?.[source]));
    }
    container.textContent = lines.join("\n");
}
/** Refresh status without sync outcomes (last-synced only). */
export async function refreshSyncStatus(container) {
    await renderSyncStatus(container);
}
//# sourceMappingURL=sync-status.js.map