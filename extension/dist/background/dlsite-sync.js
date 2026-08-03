import { getDlsiteSyncState, importDlsiteOnServer, rematchOnServer, } from "./server-client.js";
const SALES_URL = "https://play.dlsite.com/api/v3/content/sales";
/** Fetch DLsite sales history via authenticated browser session. */
export async function fetchDlsiteSales(last = "0") {
    try {
        const res = await fetch(`${SALES_URL}?last=${encodeURIComponent(last)}`, {
            credentials: "include",
        });
        if (!res.ok) {
            return { ok: false, error: `sales_${res.status}` };
        }
        const sales = await res.json();
        if (!Array.isArray(sales) || sales.length === 0) {
            return { ok: false, error: "sales_empty" };
        }
        return { ok: true, sales };
    }
    catch {
        return { ok: false, error: "sales_network" };
    }
}
/** Full manual sync: fetch sales → import → rematch. */
export async function runDlsiteSync() {
    const state = await getDlsiteSyncState();
    const cursor = state?.cursor ?? "0";
    const fetched = await fetchDlsiteSales(cursor);
    if (!fetched.ok) {
        return { ok: false, error: fetched.error };
    }
    const imported = await importDlsiteOnServer(fetched.sales);
    if (!imported.ok) {
        return { ok: false, error: imported.error, fetched: fetched.sales.length };
    }
    await rematchOnServer();
    return {
        ok: true,
        counts: imported.counts,
        fetched: fetched.sales.length,
    };
}
//# sourceMappingURL=dlsite-sync.js.map