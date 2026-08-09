import {
  ImportResponseSchema,
  LibraryImportResponseSchema,
  LookupResponseSchema,
  PriceObservationResponseSchema,
  SyncStateResponseSchema,
  type LibraryImportItem,
  type Money,
} from "@adp/shared";
import type { AmazonBooksPageReply } from "../messages.js";

export const DEFAULT_SERVER_PORT = 41321;
export const SERVER_BASE = `http://127.0.0.1:${DEFAULT_SERVER_PORT}`;

/** Stable local error when HTTP 200 JSON fails its response schema. */
export const PROTOCOL_ERROR = "protocol";

export interface ServerLookupItem {
  source?: string;
  cid?: string;
  title?: string;
  maker?: string;
}

export interface LookupResult {
  owned: boolean;
  other: Array<{ source: string; cid: string; title: string; url: string }>;
  possible?: Array<{ source: string; cid: string; title: string; url: string }>;
}

export interface ImportCounts {
  inserted: number;
  updated: number;
}

export interface AmazonImportCounts {
  observed: number;
  stored: number;
  acquiredOrUnknown: number;
  rentals: number;
}

export interface LibraryImportCounts {
  observed: number;
  inserted: number;
  updated: number;
  byState: Record<string, number>;
}

/**
 * Minimal cursor/last-synced view. `latestOutcome` is validated strictly by
 * SyncStateResponseSchema at every server-client boundary; the optional
 * outcome shape used by the popup lives in adapters/fanza/server-api.ts.
 */
export interface SyncState {
  cursor: string | null;
  lastSyncedAt: string | null;
}

export interface ImportDlsiteOptions {
  /** When false, server upserts listings but does not advance sync_state.cursor. */
  advanceCursor?: boolean;
}

/**
 * Local Amazon import counts shape (not yet a shared schema). Validated
 * strictly so a 200 malformed body cannot become a successful count.
 */
const AmazonImportCountsSchema = {
  safeParse(
    data: unknown,
  ):
    | { success: true; data: AmazonImportCounts }
    | { success: false } {
    if (data === null || typeof data !== "object") return { success: false };
    const row = data as Record<string, unknown>;
    const keys = ["observed", "stored", "acquiredOrUnknown", "rentals"] as const;
    const out: Partial<AmazonImportCounts> = {};
    for (const key of keys) {
      const value = row[key];
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        return { success: false };
      }
      out[key] = value;
    }
    // Reject unknown keys so shape stays closed.
    for (const key of Object.keys(row)) {
      if (!(keys as readonly string[]).includes(key)) return { success: false };
    }
    return { success: true, data: out as AmazonImportCounts };
  },
};

export async function serverFetch(
  path: string,
  options: RequestInit = {},
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${SERVER_BASE}${path}`, options);
    if (!res.ok) {
      return { ok: false, error: `http_${res.status}` };
    }
    const data: unknown = await res.json();
    return { ok: true, data };
  } catch {
    return { ok: false, error: "network" };
  }
}

export async function checkServerHealth(): Promise<boolean> {
  const res = await serverFetch("/api/sync-state/dlsite");
  if (!res.ok) return false;
  return SyncStateResponseSchema.safeParse(res.data).success;
}

export async function lookupOnServer(
  items: ServerLookupItem[],
): Promise<{ ok: true; results: LookupResult[] } | { ok: false }> {
  const res = await serverFetch("/api/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (!res.ok) return { ok: false };
  const parsed = LookupResponseSchema.safeParse(res.data);
  if (!parsed.success) return { ok: false };
  return { ok: true, results: parsed.data.results as LookupResult[] };
}

export async function importDlsiteOnServer(
  payload: unknown,
  options: ImportDlsiteOptions = {},
): Promise<{ ok: true; counts: ImportCounts } | { ok: false; error: string }> {
  const body =
    options.advanceCursor === false
      ? { items: payload, advanceCursor: false }
      : payload;
  const res = await serverFetch("/api/import/dlsite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, error: res.error };
  const parsed = ImportResponseSchema.safeParse(res.data);
  if (!parsed.success) return { ok: false, error: PROTOCOL_ERROR };
  return { ok: true, counts: parsed.data };
}

export async function importAmazonOnServer(
  page: Extract<AmazonBooksPageReply, { ok: true }>,
): Promise<{ ok: true; counts: AmazonImportCounts } | { ok: false; error: string }> {
  const res = await serverFetch("/api/import/amazon", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pageUrl: page.pageUrl, items: page.items }),
  });
  if (!res.ok) return { ok: false, error: res.error };
  const parsed = AmazonImportCountsSchema.safeParse(res.data);
  if (!parsed.success) return { ok: false, error: PROTOCOL_ERROR };
  return { ok: true, counts: parsed.data };
}

/** Import one bounded visible batch of the DOM library-sync protocol. */
export async function importLibraryBatchOnServer(
  source: string,
  pageUrl: string,
  items: LibraryImportItem[],
): Promise<{ ok: true; counts: LibraryImportCounts } | { ok: false; error: string }> {
  const res = await serverFetch("/api/import/library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, pageUrl, items }),
  });
  if (!res.ok) return { ok: false, error: res.error };
  const parsed = LibraryImportResponseSchema.safeParse(res.data);
  if (!parsed.success) return { ok: false, error: PROTOCOL_ERROR };
  return {
    ok: true,
    counts: {
      observed: parsed.data.observed,
      inserted: parsed.data.inserted,
      updated: parsed.data.updated,
      byState: parsed.data.byState,
    },
  };
}

/** Mark a library source synced after a successful run (sync_state). */
export async function markLibrarySourceSyncedOnServer(source: string): Promise<boolean> {
  const res = await serverFetch(`/api/sync-state/${source}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) return false;
  return SyncStateResponseSchema.safeParse(res.data).success;
}

/** Persist the global max `last=` cursor after every import chunk succeeds. */
export async function commitDlsiteCursorOnServer(
  cursor: string,
): Promise<{ ok: true; state: SyncState } | { ok: false; error: string }> {
  const res = await serverFetch("/api/sync-state/dlsite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cursor }),
  });
  if (!res.ok) return { ok: false, error: res.error };
  const parsed = SyncStateResponseSchema.safeParse(res.data);
  if (!parsed.success) return { ok: false, error: PROTOCOL_ERROR };
  return { ok: true, state: parsed.data };
}

/** POST visible three-tier prices for an already-owned listing (issue #45). */
export async function postPriceObservationOnServer(input: {
  source: string;
  cid: string;
  pageUrl: string;
  regular: Money | null;
  sale: Money | null;
  coupon: Money | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await serverFetch("/api/listings/price-observation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) return { ok: false, error: res.error };
  const parsed = PriceObservationResponseSchema.safeParse(res.data);
  if (!parsed.success) return { ok: false, error: PROTOCOL_ERROR };
  return { ok: true };
}

export async function rematchOnServer(): Promise<boolean> {
  const res = await serverFetch("/api/rematch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) return false;
  // rematch is success-gated on HTTP only for callers that only need boolean.
  // Still reject non-object 200 bodies so a garbage body is not "ok".
  if (res.data === null || typeof res.data !== "object") return false;
  const row = res.data as Record<string, unknown>;
  return (
    typeof row.rematched === "number" &&
    Number.isSafeInteger(row.rematched) &&
    row.rematched >= 0 &&
    typeof row.candidates === "number" &&
    Number.isSafeInteger(row.candidates) &&
    row.candidates >= 0
  );
}

export async function getDlsiteSyncState(): Promise<SyncState | null> {
  const res = await serverFetch("/api/sync-state/dlsite");
  if (!res.ok) return null;
  const parsed = SyncStateResponseSchema.safeParse(res.data);
  return parsed.success ? parsed.data : null;
}
