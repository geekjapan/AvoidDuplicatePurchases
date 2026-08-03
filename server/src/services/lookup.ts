import {
  makerMatchKey,
  titleMatchKey,
  dice,
  normalizeCid,
  type LookupItem,
  type LookupResult,
  type Source,
} from "@adp/shared";
import {
  productUrlForSource,
  normalizeFanzaVideoFloor,
} from "@adp/shared/adapters/dlsite";
import type { DatabaseSync } from "node:sqlite";

export interface ListingRow {
  id: number;
  source: Source;
  cid: string;
  workId: number;
  title: string;
  maker: string | null;
}

export function hasListing(db: DatabaseSync, source: Source, cid: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM listing WHERE source = ? AND cid = ?")
    .get(source, cid);
  return row !== undefined;
}

export function lookupItems(db: DatabaseSync, items: LookupItem[]): LookupResult[] {
  return items.map((item) => lookupOne(db, item));
}

/**
 * Extract FANZA Video GraphQL floor from listing.raw_json evidence.
 * Supports the minimal shapes justified by prototype/fanza GraphQL samples:
 * - `{ "floor": "AV" }`
 * - `{ "content": { "floor": "AV", "id": "..." } }`
 * - `{ "product": { "floor": "AV" } }` / `{ "product": { "content": { "floor": "AV" } } }`
 * - `{ "sale": { "floor": "AV" } }` (sale-side evidence wrapper)
 * Malformed JSON or missing/unknown floor yields null (no crash, no guessed URL).
 */
export function extractFanzaVideoFloorFromRawJson(rawJson: string | null | undefined): string | null {
  if (typeof rawJson !== "string" || rawJson.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return findVideoFloorEvidence(parsed as Record<string, unknown>);
}

function findVideoFloorEvidence(obj: Record<string, unknown>): string | null {
  if (typeof obj.floor === "string" && normalizeFanzaVideoFloor(obj.floor)) {
    return obj.floor;
  }
  if (obj.content && typeof obj.content === "object" && !Array.isArray(obj.content)) {
    const content = obj.content as Record<string, unknown>;
    if (typeof content.floor === "string" && normalizeFanzaVideoFloor(content.floor)) {
      return content.floor;
    }
  }
  if (obj.product && typeof obj.product === "object" && !Array.isArray(obj.product)) {
    const fromProduct = findVideoFloorEvidence(obj.product as Record<string, unknown>);
    if (fromProduct) return fromProduct;
  }
  if (obj.sale && typeof obj.sale === "object" && !Array.isArray(obj.sale)) {
    const fromSale = findVideoFloorEvidence(obj.sale as Record<string, unknown>);
    if (fromSale) return fromSale;
  }
  return null;
}

function lookupOne(db: DatabaseSync, item: LookupItem): LookupResult {
  let owned = false;
  if (item.source && item.cid) {
    const cid = normalizeCid(item.source, item.cid);
    owned = hasListing(db, item.source, cid);
  }

  const other: LookupResult["other"] = [];
  // Other-site ownership: exact normalized title + maker, and different source.
  if (item.title && item.maker) {
    const titleKey = titleMatchKey(item.title);
    const makerKey = makerMatchKey(item.maker);
    if (titleKey && makerKey) {
      const rows = db
        .prepare(
          `SELECT l.id, l.source, l.cid, l.title, l.maker_name, l.series_id, l.raw_json
           FROM match_key mk
           JOIN listing l ON l.id = mk.listing_id
           WHERE mk.kind = 'title' AND mk.key = ?`,
        )
        .all(titleKey) as Array<{
        id: number;
        source: Source;
        cid: string;
        title: string;
        maker_name: string | null;
        series_id: string | null;
        raw_json: string;
      }>;

      for (const row of rows) {
        if (item.source && row.source === item.source) continue;
        const rowMakerKey = makerMatchKey(row.maker_name);
        if (!rowMakerKey || rowMakerKey !== makerKey) continue;

        const videoFloor =
          row.source === "fanza_video"
            ? extractFanzaVideoFloorFromRawJson(row.raw_json)
            : null;
        const url = productUrlForSource(row.source, row.cid, {
          seriesId: row.series_id,
          videoFloor,
        });
        // Omit candidates that lack a verified canonical product URL.
        if (!url) continue;

        other.push({
          source: row.source,
          cid: row.cid,
          title: row.title,
          url,
        });
      }
    }
  }

  return { owned, other };
}

export function recomputeMatchKeys(db: DatabaseSync, listingId: number): void {
  const row = db
    .prepare("SELECT id, title, maker_name FROM listing WHERE id = ?")
    .get(listingId) as { id: number; title: string; maker_name: string | null } | undefined;
  if (!row) return;
  db.prepare("DELETE FROM match_key WHERE listing_id = ?").run(listingId);
  const titleKey = titleMatchKey(row.title);
  if (titleKey) {
    db.prepare("INSERT INTO match_key (listing_id, kind, key) VALUES (?, 'title', ?)").run(
      listingId,
      titleKey,
    );
  }
  const makerKey = makerMatchKey(row.maker_name);
  if (makerKey) {
    db.prepare("INSERT INTO match_key (listing_id, kind, key) VALUES (?, 'maker', ?)").run(
      listingId,
      makerKey,
    );
  }
}

export function runRematch(db: DatabaseSync): { rematched: number; candidates: number } {
  const listings = db
    .prepare(
      `SELECT id, work_id, work_id_locked, title, maker_name, source, cid
       FROM listing ORDER BY id`,
    )
    .all() as Array<{
    id: number;
    work_id: number;
    work_id_locked: number;
    title: string;
    maker_name: string | null;
    source: Source;
    cid: string;
  }>;

  for (const listing of listings) {
    recomputeMatchKeys(db, listing.id);
  }

  let rematched = 0;
  const unlocked = listings.filter((l) => l.work_id_locked === 0);
  const groups = new Map<string, number[]>();
  for (const listing of unlocked) {
    const key = titleMatchKey(listing.title);
    // Empty normalized keys (e.g. symbol-only titles "!!!" vs "???") must not
    // collapse unrelated listings into one automatic work_id group.
    if (!key) continue;
    const ids = groups.get(key) ?? [];
    ids.push(listing.id);
    groups.set(key, ids);
  }

  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    const workIds = new Set(
      ids.map((id) => {
        const row = db.prepare("SELECT work_id FROM listing WHERE id = ?").get(id) as {
          work_id: number;
        };
        return row.work_id;
      }),
    );
    if (workIds.size <= 1) continue;
    const targetWorkId = Math.min(...workIds);
    for (const id of ids) {
      const row = db.prepare("SELECT work_id FROM listing WHERE id = ?").get(id) as {
        work_id: number;
      };
      if (row.work_id !== targetWorkId) {
        db.prepare("UPDATE listing SET work_id = ? WHERE id = ? AND work_id_locked = 0").run(
          targetWorkId,
          id,
        );
        rematched++;
      }
    }
  }

  db.exec("DELETE FROM candidate");
  let candidates = 0;
  // Locked (decided) listings must not reappear as candidates after rematch.
  const candidateListings = db
    .prepare(
      `SELECT id, title, maker_name, source, cid
       FROM listing
       WHERE work_id_locked = 0
       ORDER BY id`,
    )
    .all() as Array<{
    id: number;
    title: string;
    maker_name: string | null;
    source: Source;
    cid: string;
  }>;

  for (let i = 0; i < candidateListings.length; i++) {
    for (let j = i + 1; j < candidateListings.length; j++) {
      const a = candidateListings[i]!;
      const b = candidateListings[j]!;
      if (a.source === b.source && a.cid === b.cid) continue;
      const makerA = makerMatchKey(a.maker_name);
      const makerB = makerMatchKey(b.maker_name);
      if (!makerA || !makerB || makerA !== makerB) continue;
      const titleA = titleMatchKey(a.title);
      const titleB = titleMatchKey(b.title);
      if (titleA === titleB) continue;
      const score = dice(titleA, titleB);
      if (score < 0.7) continue;
      db.prepare(
        "INSERT OR IGNORE INTO candidate (listing_a_id, listing_b_id, dice) VALUES (?, ?, ?)",
      ).run(a.id, b.id, score);
      candidates++;
    }
  }

  return { rematched, candidates };
}
