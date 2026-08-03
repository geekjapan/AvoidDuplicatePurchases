export const DEFAULT_SERVER_PORT = 41321;
export const SERVER_BASE = `http://127.0.0.1:${DEFAULT_SERVER_PORT}`;
export async function serverFetch(path, options = {}) {
    try {
        const res = await fetch(`${SERVER_BASE}${path}`, options);
        if (!res.ok) {
            return { ok: false, error: `http_${res.status}` };
        }
        const data = (await res.json());
        return { ok: true, data };
    }
    catch {
        return { ok: false, error: "network" };
    }
}
export async function checkServerHealth() {
    const res = await serverFetch("/api/sync-state/dlsite");
    return res.ok;
}
export async function lookupOnServer(items) {
    const res = await serverFetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
    });
    if (!res.ok)
        return { ok: false };
    return { ok: true, results: res.data.results };
}
export async function importDlsiteOnServer(payload) {
    const res = await serverFetch("/api/import/dlsite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    if (!res.ok)
        return { ok: false, error: res.error };
    return { ok: true, counts: res.data };
}
export async function rematchOnServer() {
    const res = await serverFetch("/api/rematch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
    });
    return res.ok;
}
export async function getDlsiteSyncState() {
    const res = await serverFetch("/api/sync-state/dlsite");
    return res.ok ? res.data : null;
}
//# sourceMappingURL=server-client.js.map