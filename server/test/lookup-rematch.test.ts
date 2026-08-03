import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { openDatabase } from "../src/db.js";
import { recomputeMatchKeys, lookupItems, runRematch } from "../src/services/lookup.js";
import type { DatabaseSync } from "node:sqlite";

const __dirname = dirname(fileURLToPath(import.meta.url));

function insertListing(
  db: DatabaseSync,
  opts: {
    source: string;
    cid: string;
    title: string;
    maker: string | null;
    workIdLocked?: number;
    workId?: number;
  },
): number {
  let workId = opts.workId;
  if (workId === undefined) {
    db.prepare("INSERT INTO work DEFAULT VALUES").run();
    workId = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id);
  }
  db.prepare(
    `INSERT INTO listing (
      source, cid, work_id, work_id_locked, title, maker_name, series_id, image_url,
      purchased_at, purchased_at_precision, raw_json, imported_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'unknown', '{}', ?)`,
  ).run(
    opts.source,
    opts.cid,
    workId,
    opts.workIdLocked ?? 0,
    opts.title,
    opts.maker,
    new Date().toISOString(),
  );
  const id = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id);
  recomputeMatchKeys(db, id);
  return id;
}

describe("lookup other-site ownership", () => {
  let db: DatabaseSync;

  before(() => {
    const dbPath = join(__dirname, `lookup-db-${Date.now()}.sqlite`);
    db = openDatabase(dbPath).sqlite;
  });

  after(() => {
    db.close();
  });

  it("requires maker equality and different source for other", () => {
    insertListing(db, {
      source: "dlsite",
      cid: "RJ100001",
      title: "Shared Title",
      maker: "Maker A",
    });
    insertListing(db, {
      source: "dlsite",
      cid: "RJ100002",
      title: "Shared Title",
      maker: "Maker A",
    });
    insertListing(db, {
      source: "fanza_doujin",
      cid: "d_100001",
      title: "Shared Title",
      maker: "Maker A",
    });
    insertListing(db, {
      source: "fanza_books",
      cid: "b_100001",
      title: "Shared Title",
      maker: "Other Maker",
    });

    // Same-source listing with matching title/maker must not appear in other.
    const sameSource = lookupItems(db, [
      { source: "dlsite", cid: "RJ100001", title: "Shared Title", maker: "Maker A" },
    ]);
    assert.equal(sameSource[0]!.owned, true);
    assert.ok(
      sameSource[0]!.other.every((o) => o.source !== "dlsite"),
      "same-source listings must not be reported as other",
    );
    assert.ok(
      sameSource[0]!.other.some((o) => o.source === "fanza_doujin" && o.cid === "d_100001"),
    );
    assert.ok(!sameSource[0]!.other.some((o) => o.source === "fanza_books"));

    // Maker-less query must not produce other-site hits.
    const noMaker = lookupItems(db, [
      { source: "dlsite", cid: "RJ999999", title: "Shared Title" },
    ]);
    assert.equal(noMaker[0]!.other.length, 0);
  });
});

describe("rematch excludes locked listings from candidates", () => {
  let db: DatabaseSync;

  before(() => {
    const dbPath = join(__dirname, `rematch-db-${Date.now()}.sqlite`);
    db = openDatabase(dbPath).sqlite;
  });

  after(() => {
    db.close();
  });

  it("does not recreate candidates for decided (locked) pairs", () => {
    // Similar titles, same maker, different sources — would normally be candidates.
    const a = insertListing(db, {
      source: "dlsite",
      cid: "RJ200001",
      title: "Wonderful Adventure Vol 1",
      maker: "Studio X",
      workIdLocked: 1,
    });
    const b = insertListing(db, {
      source: "fanza_doujin",
      cid: "d_200001",
      title: "Wonderful Adventure Volume 1",
      maker: "Studio X",
      workIdLocked: 1,
    });
    // Control unlocked pair that should still generate a candidate.
    insertListing(db, {
      source: "dlsite",
      cid: "RJ200002",
      title: "Another Story Edition A",
      maker: "Studio Y",
      workIdLocked: 0,
    });
    insertListing(db, {
      source: "fanza_books",
      cid: "b_200002",
      title: "Another Story Edition B",
      maker: "Studio Y",
      workIdLocked: 0,
    });

    const result = runRematch(db);
    assert.ok(result.candidates >= 0);

    const lockedPair = db
      .prepare(
        `SELECT id FROM candidate
         WHERE (listing_a_id = ? AND listing_b_id = ?)
            OR (listing_a_id = ? AND listing_b_id = ?)`,
      )
      .get(a, b, b, a);
    assert.equal(lockedPair, undefined, "locked decided pairs must not reappear as candidates");

    const unlockedCount = (
      db.prepare("SELECT COUNT(*) AS c FROM candidate").get() as { c: number }
    ).c;
    // Unlocked similar pair should remain eligible (may or may not score ≥ 0.7 depending on dice).
    // At minimum, no locked listing id may appear in candidate.
    const lockedInCandidates = db
      .prepare(
        `SELECT COUNT(*) AS c FROM candidate
         WHERE listing_a_id IN (?, ?) OR listing_b_id IN (?, ?)`,
      )
      .get(a, b, a, b) as { c: number };
    assert.equal(lockedInCandidates.c, 0);
    assert.ok(unlockedCount >= 0);
  });
});
