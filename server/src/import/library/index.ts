import type { DatabaseSync } from "node:sqlite";
import {
  LIBRARY_ITEM_STATES,
  type LibraryImportItem,
  type LibrarySource,
} from "@adp/shared";
import { upsertFanzaListing } from "../fanza/common.js";
import { recomputeMatchKeys } from "../../services/lookup.js";

export interface LibraryImportCounts {
  observed: number;
  inserted: number;
  updated: number;
  /** Per-state observed counts; every state key is always present. */
  byState: Record<string, number>;
}

export function emptyLibraryImportCounts(): LibraryImportCounts {
  const byState: Record<string, number> = {};
  for (const state of LIBRARY_ITEM_STATES) byState[state] = 0;
  return { observed: 0, inserted: 0, updated: 0, byState };
}

/**
 * Idempotent upsert of one DOM observation, keyed by (source, cid).
 * Latest observation wins; the explicit `state` is preserved verbatim and
 * never derived from title or price. Only purchased observations are mapped
 * to the idempotent listing upsert path; every other state remains an
 * observation and cannot create ownership.
 */
export function upsertLibraryObservation(
  db: DatabaseSync,
  source: LibrarySource,
  item: LibraryImportItem,
  pageUrl: string,
  now: string,
): "inserted" | "updated" {
  const exists = db
    .prepare("SELECT 1 FROM library_observation WHERE source = ? AND cid = ?")
    .get(source, item.cid.trim());
  db.prepare(
    `INSERT INTO library_observation (
      source, cid, state, title, maker_name, series_id, image_url,
      product_url, page_url, raw_json, observed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source, cid) DO UPDATE SET
      state = excluded.state,
      title = excluded.title,
      maker_name = excluded.maker_name,
      series_id = excluded.series_id,
      image_url = excluded.image_url,
      product_url = excluded.product_url,
      page_url = excluded.page_url,
      raw_json = excluded.raw_json,
      observed_at = excluded.observed_at`,
  ).run(
    source,
    item.cid.trim(),
    item.state,
    item.title.trim(),
    item.maker ?? null,
    item.seriesId ?? null,
    item.imageUrl ?? null,
    item.productUrl ?? null,
    pageUrl,
    JSON.stringify(item),
    now,
  );

  if (item.state === "purchased") {
    upsertFanzaListing(
      db,
      source,
      {
        cid: item.cid.trim(),
        title: item.title.trim(),
        maker: item.maker ?? null,
        seriesId: item.seriesId ?? null,
        imageUrl: item.imageUrl ?? null,
        purchasedAt: null,
        purchasedAtPrecision: "unknown",
        rawJson: JSON.stringify(item),
      },
      now,
    );
    const listing = db
      .prepare("SELECT id FROM listing WHERE source = ? AND cid = ?")
      .get(source, item.cid.trim()) as { id: number } | undefined;
    if (listing) recomputeMatchKeys(db, listing.id);
  }
  return exists ? "updated" : "inserted";
}

/** Import one bounded visible batch atomically; returns idempotent counts. */
export function importLibraryBatch(
  db: DatabaseSync,
  source: LibrarySource,
  pageUrl: string,
  items: LibraryImportItem[],
): LibraryImportCounts {
  const now = new Date().toISOString();
  const counts = emptyLibraryImportCounts();
  db.exec("BEGIN");
  try {
    for (const item of items) {
      const result = upsertLibraryObservation(db, source, item, pageUrl, now);
      counts.observed++;
      counts.byState[item.state] = (counts.byState[item.state] ?? 0) + 1;
      if (result === "inserted") counts.inserted++;
      else counts.updated++;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return counts;
}
