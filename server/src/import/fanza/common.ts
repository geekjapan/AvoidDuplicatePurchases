import type { Source } from "@adp/shared";
import type { DatabaseSync } from "node:sqlite";
import { recomputeMatchKeys } from "../../services/lookup.js";

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
    recomputeMatchKeys(db, existing.id);
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
  const listingId = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id);
  recomputeMatchKeys(db, listingId);
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
  for (const listing of listings) {
    const result = upsertFanzaListing(db, source, listing, now);
    if (result === "inserted") inserted++;
    else updated++;
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
): { cursor: string | null; lastSyncedAt: string | null } {
  const row = db
    .prepare("SELECT cursor, last_synced_at FROM sync_state WHERE source = ?")
    .get(source) as { cursor: string | null; last_synced_at: string } | undefined;
  if (!row) return { cursor: null, lastSyncedAt: null };
  return { cursor: row.cursor, lastSyncedAt: row.last_synced_at };
}
