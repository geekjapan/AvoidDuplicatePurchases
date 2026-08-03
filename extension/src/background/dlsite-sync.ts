import {
  getDlsiteSyncState,
  importDlsiteOnServer,
  rematchOnServer,
  type ImportCounts,
} from "./server-client.js";

const SALES_URL = "https://play.dlsite.com/api/v3/content/sales";

/** Chunk size for POST /api/import/dlsite to keep MV3 worker lifetime safe. */
export const IMPORT_CHUNK_SIZE = 40;

export interface SyncOutcome {
  ok: boolean;
  counts?: ImportCounts;
  error?: string;
  fetched?: number;
}

export interface SyncDeps {
  getDlsiteSyncState: typeof getDlsiteSyncState;
  fetchDlsiteSales: typeof fetchDlsiteSales;
  importDlsiteOnServer: typeof importDlsiteOnServer;
  rematchOnServer: typeof rematchOnServer;
}

/** Fetch DLsite sales history via authenticated browser session. */
export async function fetchDlsiteSales(last = "0"): Promise<
  { ok: true; sales: unknown[] } | { ok: false; error: string }
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

/** Split a sales array into fixed-size import chunks. */
export function chunkSales<T>(sales: readonly T[], chunkSize = IMPORT_CHUNK_SIZE): T[][] {
  const size = Math.max(1, chunkSize);
  const chunks: T[][] = [];
  for (let i = 0; i < sales.length; i += size) {
    chunks.push(sales.slice(i, i + size));
  }
  return chunks;
}

/** Full manual sync: fetch sales → chunked import → rematch. */
export async function runDlsiteSync(deps: Partial<SyncDeps> = {}): Promise<SyncOutcome> {
  const getState = deps.getDlsiteSyncState ?? getDlsiteSyncState;
  const fetchSales = deps.fetchDlsiteSales ?? fetchDlsiteSales;
  const importOnServer = deps.importDlsiteOnServer ?? importDlsiteOnServer;
  const rematch = deps.rematchOnServer ?? rematchOnServer;

  const state = await getState();
  const cursor = state?.cursor ?? "0";
  const fetched = await fetchSales(cursor);
  if (!fetched.ok) {
    return { ok: false, error: fetched.error };
  }

  const sales = fetched.sales;
  let inserted = 0;
  let updated = 0;

  for (const chunk of chunkSales(sales, IMPORT_CHUNK_SIZE)) {
    const imported = await importOnServer(chunk);
    if (!imported.ok) {
      return {
        ok: false,
        error: imported.error,
        fetched: sales.length,
        counts: { inserted, updated },
      };
    }
    inserted += imported.counts.inserted;
    updated += imported.counts.updated;
  }

  const rematchOk = await rematch();
  if (!rematchOk) {
    return {
      ok: false,
      error: "rematch_failed",
      counts: { inserted, updated },
      fetched: sales.length,
    };
  }

  return {
    ok: true,
    counts: { inserted, updated },
    fetched: sales.length,
  };
}
