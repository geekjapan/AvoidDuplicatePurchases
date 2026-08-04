import {
  SERVER_BASE,
  type ImportCounts,
  type SyncState,
} from "../../background/server-client.js";

export type { ImportCounts, SyncState };

export interface PersistedSyncOutcome {
  ok: boolean;
  counts: ImportCounts;
  error: string | null;
  fetched: number | null;
  recordedAt: string;
}

export interface SyncStateWithOutcome extends SyncState {
  latestOutcome?: PersistedSyncOutcome | null;
}

export type FanzaImportSource =
  | "fanza_doujin"
  | "fanza_books"
  | "fanza_video"
  | "fanza_dlsoft";

export type SyncSource = (typeof ALL_SYNC_SOURCES)[number];

export const FANZA_SOURCES: readonly FanzaImportSource[] = [
  "fanza_doujin",
  "fanza_books",
  "fanza_video",
  "fanza_dlsoft",
];

export const ALL_SYNC_SOURCES = ["dlsite", ...FANZA_SOURCES] as const;

export interface FanzaImportResult extends ImportCounts {
  series?: Array<{
    seriesId: string;
    author: string | null;
    seriesRaw?: Record<string, unknown> | null;
  }>;
  hasNext?: boolean;
  itemCount?: number;
  totalCount?: number;
}

async function serverFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${SERVER_BASE}${path}`, options);
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, error: "network" };
  }
}

export async function importFanzaOnServer(
  source: FanzaImportSource,
  payload: unknown,
): Promise<{ ok: true; result: FanzaImportResult } | { ok: false; error: string }> {
  const res = await serverFetch<FanzaImportResult>(`/api/import/${source}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, result: res.data };
}

export async function markFanzaSyncedOnServer(
  source: FanzaImportSource,
): Promise<{ ok: true; state: SyncState } | { ok: false; error: string }> {
  const res = await serverFetch<SyncState>(`/api/sync-state/${source}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, state: res.data };
}

export async function persistSyncOutcomeOnServer(
  source: SyncSource,
  outcome: {
    ok: boolean;
    counts?: ImportCounts;
    error?: string;
    fetched?: number;
  },
): Promise<boolean> {
  const res = await serverFetch<{ ok: boolean }>(`/api/sync-outcome/${source}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(outcome),
  });
  return res.ok && res.data.ok === true;
}

export async function getSourceSyncState(source: string): Promise<SyncStateWithOutcome | null> {
  const res = await serverFetch<SyncStateWithOutcome>(`/api/sync-state/${source}`);
  return res.ok ? res.data : null;
}

export async function getAllSyncStates(): Promise<Record<string, SyncStateWithOutcome | null>> {
  const states: Record<string, SyncStateWithOutcome | null> = {};
  for (const source of ALL_SYNC_SOURCES) {
    states[source] = await getSourceSyncState(source);
  }
  return states;
}

export function listSyncSources(): readonly string[] {
  return ALL_SYNC_SOURCES;
}
