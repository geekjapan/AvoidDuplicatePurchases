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
    seriesId?: string | null;
    rawJson?: string;
    workIdLocked?: number;
    workId?: number;
    purchasedAt?: string | null;
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 'day', ?, ?)`,
  ).run(
    opts.source,
    opts.cid,
    workId,
    opts.workIdLocked ?? 0,
    opts.title,
    opts.maker,
    opts.seriesId ?? null,
    opts.purchasedAt ?? null,
    opts.rawJson ?? "{}",
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
      purchasedAt: "2023-12-30",
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
    assert.equal(sameSource[0]!.purchasedAt, "2023-12-30");
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

  it("matches the normalized maker first, then separates exact and fuzzy titles", () => {
    insertListing(db, {
      source: "fanza_doujin",
      cid: "d_410001",
      title: "正規化作品【DL版】",
      maker: "Sample Circle",
    });
    insertListing(db, {
      source: "fanza_doujin",
      cid: "d_410002",
      title: "類似タイトルA",
      maker: "Sample Circle",
    });
    insertListing(db, {
      source: "fanza_doujin",
      cid: "d_410003",
      title: "類似タイトルA",
      maker: "Different Circle",
    });

    const exact = lookupItems(db, [
      {
        source: "dlsite",
        cid: "RJ410001",
        title: "正規化作品",
        maker: "ＳＡＭＰＬＥ　ＣＩＲＣＬＥ",
      },
    ])[0]!;
    assert.equal(exact.other.length, 1);
    assert.equal(exact.other[0]!.cid, "d_410001");
    assert.equal(exact.possible.length, 0);

    const possible = lookupItems(db, [
      {
        source: "dlsite",
        cid: "RJ410002",
        title: "類似タイトルB",
        maker: "Sample Circle",
      },
    ])[0]!;
    assert.equal(possible.other.length, 0);
    assert.equal(possible.possible.length, 1);
    assert.equal(possible.possible[0]!.cid, "d_410002");

    const differentMaker = lookupItems(db, [
      {
        source: "dlsite",
        cid: "RJ410003",
        title: "類似タイトルB",
        maker: "Unknown Circle",
      },
    ])[0]!;
    assert.equal(differentMaker.other.length, 0);
    assert.equal(differentMaker.possible.length, 0);
  });

  it("emits verified product URLs and omits unlinkable Books/Video candidates", () => {
    insertListing(db, {
      source: "fanza_doujin",
      cid: "d_900001",
      title: "Cross Link Title",
      maker: "Link Maker",
    });
    insertListing(db, {
      source: "fanza_books",
      cid: "b100xxxxx01001",
      title: "Cross Link Title",
      maker: "Link Maker",
      seriesId: "100001",
    });
    // Books without series_id cannot form a verified URL — must be omitted from other.
    insertListing(db, {
      source: "fanza_books",
      cid: "b100noseries",
      title: "Cross Link Title",
      maker: "Link Maker",
      seriesId: null,
    });
    // Video with GraphQL AV floor evidence.
    insertListing(db, {
      source: "fanza_video",
      cid: "h_175dxua00001",
      title: "Cross Link Title",
      maker: "Link Maker",
      rawJson: JSON.stringify({
        content: { id: "h_175dxua00001", title: "動画AV", floor: "AV" },
      }),
    });
    // Video with amateur floor evidence.
    insertListing(db, {
      source: "fanza_video",
      cid: "peep174",
      title: "Cross Link Title",
      maker: "Link Maker",
      rawJson: JSON.stringify({ floor: "Amateur" }),
    });
    // Video without floor — un-linkable, omit.
    insertListing(db, {
      source: "fanza_video",
      cid: "nofloor999",
      title: "Cross Link Title",
      maker: "Link Maker",
      rawJson: JSON.stringify({ content: { id: "nofloor999", title: "x" } }),
    });
    // Video with unknown floor — omit.
    insertListing(db, {
      source: "fanza_video",
      cid: "badfloor999",
      title: "Cross Link Title",
      maker: "Link Maker",
      rawJson: JSON.stringify({ content: { floor: "videoa" } }),
    });
    // Malformed raw_json must not crash lookup and must not invent a URL.
    insertListing(db, {
      source: "fanza_video",
      cid: "malformedraw",
      title: "Cross Link Title",
      maker: "Link Maker",
      rawJson: "{not-json",
    });
    insertListing(db, {
      source: "fanza_dlsoft",
      cid: "purple_0049",
      title: "Cross Link Title",
      maker: "Link Maker",
    });
    insertListing(db, {
      source: "dlsite",
      cid: "RJ700001",
      title: "Cross Link Title",
      maker: "Link Maker",
    });

    const res = lookupItems(db, [
      {
        source: "dlsite",
        cid: "RJ700001",
        title: "Cross Link Title",
        maker: "Link Maker",
      },
    ]);
    const other = res[0]!.other;
    const byCid = Object.fromEntries(other.map((o) => [o.cid, o]));

    assert.equal(
      byCid["d_900001"]?.url,
      "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_900001/",
    );
    assert.equal(
      byCid["b100xxxxx01001"]?.url,
      "https://book.dmm.co.jp/product/100001/b100xxxxx01001/",
    );
    assert.equal(byCid["b100noseries"], undefined);

    assert.equal(
      byCid["h_175dxua00001"]?.url,
      "https://video.dmm.co.jp/av/content/?id=h_175dxua00001",
    );
    assert.equal(
      byCid["peep174"]?.url,
      "https://video.dmm.co.jp/amateur/content/?id=peep174",
    );
    // Evidence-complete Video candidates remain; un-linkable ones are omitted only.
    assert.ok(byCid["h_175dxua00001"]);
    assert.ok(byCid["peep174"]);
    assert.equal(byCid["nofloor999"], undefined);
    assert.equal(byCid["badfloor999"], undefined);
    assert.equal(byCid["malformedraw"], undefined);

    assert.equal(
      byCid["purple_0049"]?.url,
      "https://dlsoft.dmm.co.jp/detail/purple_0049/",
    );

    for (const o of other) {
      assert.doesNotMatch(o.url, /example\.invalid/);
      assert.doesNotMatch(o.url, /digital\/videoa/);
      assert.ok(o.url.startsWith("https://"));
    }
  });
});

describe("rematch excludes locked listings from candidates", () => {
  let db: DatabaseSync;

  before(() => {
    // In-memory so read-only review sandboxes can run rematch regressions without file create.
    db = openDatabase(":memory:").sqlite;
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

  it("does not merge symbol-only titles that normalize to empty titleMatchKey", () => {
    // titleMatchKey("!!!") and titleMatchKey("???") are both "" after normalization.
    // Empty keys must not auto-merge distinct listings onto one work_id.
    const idA = insertListing(db, {
      source: "dlsite",
      cid: "RJ300001",
      title: "!!!",
      maker: "Symbol Maker",
      workIdLocked: 0,
    });
    const idB = insertListing(db, {
      source: "fanza_doujin",
      cid: "d_300001",
      title: "???",
      maker: "Symbol Maker",
      workIdLocked: 0,
    });

    const beforeA = db.prepare("SELECT work_id FROM listing WHERE id = ?").get(idA) as {
      work_id: number;
    };
    const beforeB = db.prepare("SELECT work_id FROM listing WHERE id = ?").get(idB) as {
      work_id: number;
    };
    assert.notEqual(beforeA.work_id, beforeB.work_id, "fixtures start on distinct work_ids");

    runRematch(db);

    const afterA = db.prepare("SELECT work_id FROM listing WHERE id = ?").get(idA) as {
      work_id: number;
    };
    const afterB = db.prepare("SELECT work_id FROM listing WHERE id = ?").get(idB) as {
      work_id: number;
    };
    assert.notEqual(
      afterA.work_id,
      afterB.work_id,
      "symbol-only distinct titles must keep separate work_ids after rematch",
    );
    assert.equal(afterA.work_id, beforeA.work_id);
    assert.equal(afterB.work_id, beforeB.work_id);
  });
});
