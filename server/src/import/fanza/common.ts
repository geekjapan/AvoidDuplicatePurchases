import type { Source } from "@adp/shared";
import type { DatabaseSync } from "node:sqlite";
import { dispatchSyncSuccess } from "../../hooks/sync-success.js";

export interface UpsertableListing {
  cid: string;
  title: string;
  maker: string | null;
  seriesId: string | null;
  imageUrl: string | null;
  purchasedAt: string | null;
  purchasedAtPrecision: "second" | "day" | "unknown";
  rawJson: string;
}

export interface ImportCounts {
  inserted: number;
  updated: number;
}

export interface SyncOutcomeInput {
  ok: boolean;
  counts?: ImportCounts;
  error?: string;
  fetched?: number;
}

export interface PersistedSyncOutcome {
  ok: boolean;
  counts: ImportCounts;
  error: string | null;
  fetched: number | null;
  recordedAt: string;
}

export interface SyncStateWithOutcome {
  cursor: string | null;
  lastSyncedAt: string | null;
  latestOutcome: PersistedSyncOutcome | null;
}

/**
 * Reserved sync_state.source key for latest outcomes.
 * Reuses the migration-backed sync_state table — no runtime DDL.
 */
function outcomeSourceKey(source: string): string {
  return `__sync_outcome__:${source}`;
}

function parseOutcomeCursor(
  cursor: string | null,
  recordedAt: string,
): PersistedSyncOutcome | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(cursor) as {
      ok?: unknown;
      counts?: { inserted?: unknown; updated?: unknown };
      error?: unknown;
      fetched?: unknown;
      recordedAt?: unknown;
    };
    if (typeof parsed.ok !== "boolean") return null;
    const inserted =
      typeof parsed.counts?.inserted === "number" ? parsed.counts.inserted : 0;
    const updated =
      typeof parsed.counts?.updated === "number" ? parsed.counts.updated : 0;
    return {
      ok: parsed.ok,
      counts: { inserted, updated },
      error: typeof parsed.error === "string" ? parsed.error : null,
      fetched: typeof parsed.fetched === "number" ? parsed.fetched : null,
      recordedAt:
        typeof parsed.recordedAt === "string" && parsed.recordedAt
          ? parsed.recordedAt
          : recordedAt,
    };
  } catch {
    return null;
  }
}

export function persistSyncOutcome(
  db: DatabaseSync,
  source: string,
  outcome: SyncOutcomeInput,
  now = new Date().toISOString(),
): void {
  const payload: PersistedSyncOutcome = {
    ok: outcome.ok,
    counts: {
      inserted: outcome.counts?.inserted ?? 0,
      updated: outcome.counts?.updated ?? 0,
    },
    error: outcome.error ?? null,
    fetched: outcome.fetched ?? null,
    recordedAt: now,
  };
  // Persist into existing sync_state rows (migration-backed). No CREATE TABLE.
  db.prepare(
    `INSERT INTO sync_state (source, cursor, last_synced_at) VALUES (?, ?, ?)
     ON CONFLICT(source) DO UPDATE SET
       cursor = excluded.cursor,
       last_synced_at = excluded.last_synced_at`,
  ).run(outcomeSourceKey(source), JSON.stringify(payload), now);

  if (outcome.ok) {
    dispatchSyncSuccess({
      source,
      outcome: {
        ok: true,
        counts: payload.counts,
        error: null,
        fetched: payload.fetched,
        recordedAt: payload.recordedAt,
      },
    });
  }
}

export function getLatestSyncOutcome(
  db: DatabaseSync,
  source: string,
): PersistedSyncOutcome | null {
  // Read-only SELECT against migration-backed schema. Never mutates schema.
  const row = db
    .prepare("SELECT cursor, last_synced_at FROM sync_state WHERE source = ?")
    .get(outcomeSourceKey(source)) as
    | { cursor: string | null; last_synced_at: string }
    | undefined;
  if (!row) return null;
  return parseOutcomeCursor(row.cursor, row.last_synced_at);
}

function preferNonNull<T>(next: T | null, prev: T | null): T | null {
  return next !== null && next !== undefined ? next : prev;
}

/**
 * Deep object merge: keep prior nested keys that a partial later import omits,
 * while letting new keys win on conflict. Arrays and scalars are replaced.
 */
function deepMergeEvidence(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...prev, ...next };
  for (const key of Object.keys(prev)) {
    const p = prev[key];
    const n = next[key];
    if (
      p &&
      typeof p === "object" &&
      !Array.isArray(p) &&
      n &&
      typeof n === "object" &&
      !Array.isArray(n)
    ) {
      merged[key] = deepMergeEvidence(
        p as Record<string, unknown>,
        n as Record<string, unknown>,
      );
    }
  }
  return merged;
}

/**
 * Lossless raw evidence merge: keep prior top-level and nested object keys that
 * a partial later import omits, while letting new keys win on conflict.
 */
export function mergeRawJsonEvidence(prevRaw: string, nextRaw: string): string {
  try {
    const prev = JSON.parse(prevRaw) as unknown;
    const next = JSON.parse(nextRaw) as unknown;
    if (
      !prev ||
      typeof prev !== "object" ||
      Array.isArray(prev) ||
      !next ||
      typeof next !== "object" ||
      Array.isArray(next)
    ) {
      return nextRaw;
    }
    return JSON.stringify(
      deepMergeEvidence(prev as Record<string, unknown>, next as Record<string, unknown>),
    );
  } catch {
    // Unparseable prior evidence: keep it rather than destroying with partial next.
    return prevRaw || nextRaw;
  }
}

export function upsertFanzaListing(
  db: DatabaseSync,
  source: Source,
  listing: UpsertableListing,
  now: string,
): "inserted" | "updated" {
  const cid = listing.cid.trim();
  const existing = db
    .prepare(
      `SELECT id, maker_name, series_id, image_url, purchased_at, raw_json
       FROM listing WHERE source = ? AND cid = ?`,
    )
    .get(source, cid) as
    | {
        id: number;
        maker_name: string | null;
        series_id: string | null;
        image_url: string | null;
        purchased_at: string | null;
        raw_json: string;
      }
    | undefined;

  if (existing) {
    const maker = preferNonNull(listing.maker, existing.maker_name);
    const seriesId = preferNonNull(listing.seriesId, existing.series_id);
    const imageUrl = preferNonNull(listing.imageUrl, existing.image_url);
    const purchasedAt = preferNonNull(listing.purchasedAt, existing.purchased_at);
    const rawJson = mergeRawJsonEvidence(existing.raw_json, listing.rawJson);
    db.prepare(
      `UPDATE listing SET
        title = ?, maker_name = ?, series_id = ?, image_url = ?,
        purchased_at = ?, purchased_at_precision = ?, raw_json = ?, imported_at = ?
       WHERE id = ?`,
    ).run(
      listing.title,
      maker,
      seriesId,
      imageUrl,
      purchasedAt,
      listing.purchasedAtPrecision,
      rawJson,
      now,
      existing.id,
    );
    return "updated";
  }

  db.prepare("INSERT INTO work DEFAULT VALUES").run();
  const workId = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id);
  db.prepare(
    `INSERT INTO listing (
      source, cid, work_id, title, maker_name, series_id, image_url,
      purchased_at, purchased_at_precision, raw_json, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    source,
    cid,
    workId,
    listing.title,
    listing.maker,
    listing.seriesId,
    listing.imageUrl,
    listing.purchasedAt,
    listing.purchasedAtPrecision,
    listing.rawJson,
    now,
  );
  return "inserted";
}

export function importListingBatch(
  db: DatabaseSync,
  source: Source,
  listings: UpsertableListing[],
): ImportCounts {
  const now = new Date().toISOString();
  let inserted = 0;
  let updated = 0;
  db.exec("BEGIN");
  try {
    for (const listing of listings) {
      const result = upsertFanzaListing(db, source, listing, now);
      if (result === "inserted") inserted++;
      else updated++;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { inserted, updated };
}

export function markSourceSynced(db: DatabaseSync, source: string, now = new Date().toISOString()): void {
  db.prepare(
    `INSERT INTO sync_state (source, cursor, last_synced_at) VALUES (?, NULL, ?)
     ON CONFLICT(source) DO UPDATE SET last_synced_at = excluded.last_synced_at`,
  ).run(source, now);
}

export function getSyncState(
  db: DatabaseSync,
  source: string,
): SyncStateWithOutcome {
  const row = db
    .prepare("SELECT cursor, last_synced_at FROM sync_state WHERE source = ?")
    .get(source) as { cursor: string | null; last_synced_at: string } | undefined;
  return {
    cursor: row?.cursor ?? null,
    lastSyncedAt: row?.last_synced_at ?? null,
    latestOutcome: getLatestSyncOutcome(db, source),
  };
}
