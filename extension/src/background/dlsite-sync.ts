import {
  getDlsiteSyncState,
  importDlsiteOnServer,
  rematchOnServer,
  type ImportCounts,
} from "./server-client.js";

const SALES_URL = "https://play.dlsite.com/api/v3/content/sales";

export interface SyncOutcome {
  ok: boolean;
  counts?: ImportCounts;
  error?: string;
  fetched?: number;
}

/** Fetch DLsite sales history via authenticated browser session. */
export async function fetchDlsiteSales(last = "0"): Promise<
  { ok: true; sales: unknown } | { ok: false; error: string }
> {
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
  } catch {
    return { ok: false, error: "sales_network" };
  }
}

/** Full manual sync: fetch sales → import → rematch. */
export async function runDlsiteSync(): Promise<SyncOutcome> {
  const state = await getDlsiteSyncState();
  const cursor = state?.cursor ?? "0";
  const fetched = await fetchDlsiteSales(cursor);
  if (!fetched.ok) {
    return { ok: false, error: fetched.error };
  }

  const imported = await importDlsiteOnServer(fetched.sales);
  if (!imported.ok) {
    return { ok: false, error: imported.error, fetched: (fetched.sales as unknown[]).length };
  }

  await rematchOnServer();

  return {
    ok: true,
    counts: imported.counts,
    fetched: (fetched.sales as unknown[]).length,
  };
}
