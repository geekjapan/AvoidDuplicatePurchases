import type { Source } from "@adp/shared";
import type { DatabaseSync } from "node:sqlite";

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

function ensureSyncOutcomeTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_outcome (
      source TEXT PRIMARY KEY,
      ok INTEGER NOT NULL,
      inserted INTEGER NOT NULL,
      updated INTEGER NOT NULL,
      error TEXT,
      fetched INTEGER,
      recorded_at TEXT NOT NULL
    )
  `);
}

export function persistSyncOutcome(
  db: DatabaseSync,
  source: string,
  outcome: SyncOutcomeInput,
  now = new Date().toISOString(),
): void {
  ensureSyncOutcomeTable(db);
  db.prepare(
    `INSERT INTO sync_outcome
       (source, ok, inserted, updated, error, fetched, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source) DO UPDATE SET
       ok = excluded.ok,
       inserted = excluded.inserted,
       updated = excluded.updated,
       error = excluded.error,
       fetched = excluded.fetched,
       recorded_at = excluded.recorded_at`,
  ).run(
    source,
    outcome.ok ? 1 : 0,
    outcome.counts?.inserted ?? 0,
    outcome.counts?.updated ?? 0,
    outcome.error ?? null,
    outcome.fetched ?? null,
    now,
  );
}

export function getLatestSyncOutcome(
  db: DatabaseSync,
  source: string,
): PersistedSyncOutcome | null {
  ensureSyncOutcomeTable(db);
  const row = db
    .prepare(
      `SELECT ok, inserted, updated, error, fetched, recorded_at
       FROM sync_outcome WHERE source = ?`,
    )
    .get(source) as {
    ok: number;
    inserted: number;
    updated: number;
    error: string | null;
    fetched: number | null;
    recorded_at: string;
  } | undefined;
  if (!row) return null;
  return {
    ok: row.ok === 1,
    counts: { inserted: row.inserted, updated: row.updated },
    error: row.error,
    fetched: row.fetched,
    recordedAt: row.recorded_at,
  };
}

export function upsertFanzaListing(
  db: DatabaseSync,
  source: Source,
  listing: UpsertableListing,
  now: string,
): "inserted" | "updated" {
  const cid = listing.cid.trim();
  const existing = db
    .prepare("SELECT id FROM listing WHERE source = ? AND cid = ?")
    .get(source, cid) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE listing SET
        title = ?, maker_name = ?, series_id = ?, image_url = ?,
        purchased_at = ?, purchased_at_precision = ?, raw_json = ?, imported_at = ?
       WHERE id = ?`,
    ).run(
      listing.title,
      listing.maker,
      listing.seriesId,
      listing.imageUrl,
      listing.purchasedAt,
      listing.purchasedAtPrecision,
      listing.rawJson,
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
