export const DEFAULT_SERVER_PORT = 41321;
export const SERVER_BASE = `http://127.0.0.1:${DEFAULT_SERVER_PORT}`;

export interface ServerLookupItem {
  source?: string;
  cid?: string;
  title?: string;
  maker?: string;
}

export interface LookupResult {
  owned: boolean;
  other: Array<{ source: string; cid: string; title: string; url: string }>;
}

export interface ImportCounts {
  inserted: number;
  updated: number;
}

export interface SyncState {
  cursor: string | null;
  lastSyncedAt: string | null;
}

export async function serverFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${SERVER_BASE}${path}`, options);
    if (!res.ok) {
      return { ok: false, error: `http_${res.status}` };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch {
    return { ok: false, error: "network" };
  }
}

export async function checkServerHealth(): Promise<boolean> {
  const res = await serverFetch<SyncState>("/api/sync-state/dlsite");
  return res.ok;
}

export async function lookupOnServer(
  items: ServerLookupItem[],
): Promise<{ ok: true; results: LookupResult[] } | { ok: false }> {
  const res = await serverFetch<{ results: LookupResult[] }>("/api/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) return { ok: false };
  return { ok: true, results: res.data.results };
}

export async function importDlsiteOnServer(
  payload: unknown,
): Promise<{ ok: true; counts: ImportCounts } | { ok: false; error: string }> {
  const res = await serverFetch<ImportCounts>("/api/import/dlsite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, counts: res.data };
}

export async function rematchOnServer(): Promise<boolean> {
  const res = await serverFetch<{ rematched: number; candidates: number }>("/api/rematch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  return res.ok;
}

export async function getDlsiteSyncState(): Promise<SyncState | null> {
  const res = await serverFetch<SyncState>("/api/sync-state/dlsite");
  return res.ok ? res.data : null;
}
