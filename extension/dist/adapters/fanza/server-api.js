import { SERVER_BASE, } from "../../background/server-client.js";
export const FANZA_SOURCES = [
    "fanza_doujin",
    "fanza_books",
    "fanza_video",
    "fanza_dlsoft",
];
export const ALL_SYNC_SOURCES = ["dlsite", ...FANZA_SOURCES];
async function serverFetch(path, options = {}) {
    try {
        const res = await fetch(`${SERVER_BASE}${path}`, options);
        if (!res.ok)
            return { ok: false, error: `http_${res.status}` };
        return { ok: true, data: (await res.json()) };
    }
    catch {
        return { ok: false, error: "network" };
    }
}
export async function importFanzaOnServer(source, payload) {
    const res = await serverFetch(`/api/import/${source}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    if (!res.ok)
        return { ok: false, error: res.error };
    return { ok: true, counts: res.data };
}
export async function markFanzaSyncedOnServer(source) {
    const res = await serverFetch(`/api/sync-state/${source}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
    });
    if (!res.ok)
        return { ok: false, error: res.error };
    return { ok: true, state: res.data };
}
export async function getSourceSyncState(source) {
    const res = await serverFetch(`/api/sync-state/${source}`);
    return res.ok ? res.data : null;
}
export async function getAllSyncStates() {
    const states = {};
    for (const source of ALL_SYNC_SOURCES) {
        states[source] = await getSourceSyncState(source);
    }
    return states;
}
export function listSyncSources() {
    return ALL_SYNC_SOURCES;
}
//# sourceMappingURL=server-api.js.map