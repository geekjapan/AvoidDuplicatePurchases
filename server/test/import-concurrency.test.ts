import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { openDatabase } from "../src/db.js";
import {
  importDlsitePayload,
  commitDlsiteCursor,
  PRODUCT_FETCH_CONCURRENCY,
} from "../src/services/import.js";
import type { DatabaseSync } from "node:sqlite";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("import bounded enrichment", () => {
  let db: DatabaseSync;

  before(() => {
    const dbPath = join(__dirname, `import-db-${Date.now()}.sqlite`);
    db = openDatabase(dbPath).sqlite;
  });

  after(() => {
    db.close();
  });

  it("fetches products with bounded concurrency and advances cursor after batch", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchOrder: string[] = [];

    const sales = Array.from({ length: 12 }, (_, i) => ({
      workno: `RJ${String(300000 + i).padStart(6, "0")}`,
      sales_date: `2024-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
    }));

    const counts = await importDlsitePayload(
      db,
      sales,
      async (workno) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        fetchOrder.push(workno);
        await new Promise((r) => setTimeout(r, 15));
        inFlight--;
        return null;
      },
      4,
    );

    assert.equal(counts.inserted, 12);
    assert.ok(maxInFlight <= 4, `expected concurrency ≤ 4, got ${maxInFlight}`);
    assert.ok(maxInFlight > 1, "expected concurrent product fetches");
    assert.equal(fetchOrder.length, 12);

    const state = db
      .prepare("SELECT cursor FROM sync_state WHERE source = 'dlsite'")
      .get() as { cursor: string };
    assert.equal(state.cursor, "2024-01-12T00:00:00.000Z");
    assert.equal(PRODUCT_FETCH_CONCURRENCY, 6);
  });

  it("falls back to history-only listing when product.workno mismatches sale", async () => {
    const saleWorkno = "RJ410001";
    await importDlsitePayload(
      db,
      [{ workno: saleWorkno, sales_date: "2024-03-01T00:00:00.000Z" }],
      async () => [
        {
          workno: "RJ999999",
          work_name: "別作品タイトル",
          maker_name: "別メーカー",
          series_id: null,
          image_url: null,
        },
      ],
      1,
      { advanceCursor: false },
    );

    const row = db
      .prepare("SELECT title, maker_name FROM listing WHERE source = 'dlsite' AND cid = ?")
      .get(saleWorkno) as { title: string; maker_name: string | null };
    assert.equal(row.title, saleWorkno);
    assert.equal(row.maker_name, null);
  });

  it("preserves existing enrichment and product raw evidence when re-import product fetch fails", async () => {
    const workno = "RJ420001";
    const product = [
      {
        workno,
        work_name: "保持されるタイトル",
        maker_name: "保持メーカー",
        series_id: "S1",
        image_url: "https://img.example/a.jpg",
        work_pack_parent: "RJ420099",
      },
    ];

    await importDlsitePayload(
      db,
      [{ workno, sales_date: "2024-01-01T00:00:00.000Z" }],
      async () => product,
      1,
      { advanceCursor: false },
    );

    const before = db
      .prepare(
        `SELECT title, maker_name, series_id, image_url, raw_json FROM listing
         WHERE source = 'dlsite' AND cid = ?`,
      )
      .get(workno) as {
      title: string;
      maker_name: string | null;
      series_id: string | null;
      image_url: string | null;
      raw_json: string;
    };
    assert.equal(before.title, "保持されるタイトル");
    assert.equal(before.maker_name, "保持メーカー");
    const beforeKeys = db
      .prepare("SELECT kind, key FROM match_key WHERE listing_id = (SELECT id FROM listing WHERE cid = ?)")
      .all(workno) as Array<{ kind: string; key: string }>;
    assert.ok(beforeKeys.some((k) => k.kind === "title"));

    // Transient null fetch must not degrade enrichment or erase product raw evidence.
    await importDlsitePayload(
      db,
      [{ workno, sales_date: "2024-02-01T00:00:00.000Z" }],
      async () => null,
      1,
      { advanceCursor: false },
    );

    const afterNull = db
      .prepare(
        `SELECT title, maker_name, series_id, image_url, purchased_at, raw_json FROM listing
         WHERE source = 'dlsite' AND cid = ?`,
      )
      .get(workno) as {
      title: string;
      maker_name: string | null;
      series_id: string | null;
      image_url: string | null;
      purchased_at: string;
      raw_json: string;
    };
    assert.equal(afterNull.title, "保持されるタイトル");
    assert.equal(afterNull.maker_name, "保持メーカー");
    assert.equal(afterNull.series_id, "S1");
    assert.equal(afterNull.image_url, "https://img.example/a.jpg");
    assert.equal(afterNull.purchased_at, "2024-02-01T00:00:00.000Z");
    const afterRaw = JSON.parse(afterNull.raw_json) as {
      product?: { work_pack_parent?: string; work_name?: string };
    };
    assert.equal(afterRaw.product?.work_pack_parent, "RJ420099");
    assert.equal(afterRaw.product?.work_name, "保持されるタイトル");

    const afterKeys = db
      .prepare("SELECT kind, key FROM match_key WHERE listing_id = (SELECT id FROM listing WHERE cid = ?)")
      .all(workno) as Array<{ kind: string; key: string }>;
    assert.deepEqual(afterKeys, beforeKeys);

    // CID-mismatched product also preserves enrichment.
    await importDlsitePayload(
      db,
      [{ workno, sales_date: "2024-03-01T00:00:00.000Z" }],
      async () => [
        {
          workno: "RJ999999",
          work_name: "別人",
          maker_name: "別人メーカー",
          series_id: null,
          image_url: null,
        },
      ],
      1,
      { advanceCursor: false },
    );
    const afterMismatch = db
      .prepare("SELECT title, maker_name FROM listing WHERE source = 'dlsite' AND cid = ?")
      .get(workno) as { title: string; maker_name: string | null };
    assert.equal(afterMismatch.title, "保持されるタイトル");
    assert.equal(afterMismatch.maker_name, "保持メーカー");

    // Valid enrichment may still update metadata.
    await importDlsitePayload(
      db,
      [{ workno, sales_date: "2024-04-01T00:00:00.000Z" }],
      async () => [
        {
          workno,
          work_name: "更新タイトル",
          maker_name: "更新メーカー",
          series_id: "S2",
          image_url: "https://img.example/b.jpg",
          work_pack_parent: "RJ420100",
        },
      ],
      1,
      { advanceCursor: false },
    );
    const afterOk = db
      .prepare(
        `SELECT title, maker_name, series_id, image_url, raw_json FROM listing
         WHERE source = 'dlsite' AND cid = ?`,
      )
      .get(workno) as {
      title: string;
      maker_name: string | null;
      series_id: string | null;
      image_url: string | null;
      raw_json: string;
    };
    assert.equal(afterOk.title, "更新タイトル");
    assert.equal(afterOk.maker_name, "更新メーカー");
    assert.equal(afterOk.series_id, "S2");
    assert.equal(JSON.parse(afterOk.raw_json).product.work_pack_parent, "RJ420100");
  });

  it("skips cursor advance when advanceCursor is false and commits global max later", async () => {
    const prior = "2020-01-01T00:00:00.000Z";
    commitDlsiteCursor(db, prior);

    const earlyMaxChunk = [
      { workno: "RJ400001", sales_date: "2024-12-01T00:00:00.000Z" },
      { workno: "RJ400002", sales_date: "2024-01-01T00:00:00.000Z" },
    ];
    const lateLowChunk = [
      { workno: "RJ400003", sales_date: "2024-02-01T00:00:00.000Z" },
    ];

    await importDlsitePayload(db, earlyMaxChunk, async () => null, 2, {
      advanceCursor: false,
    });
    let state = db
      .prepare("SELECT cursor FROM sync_state WHERE source = 'dlsite'")
      .get() as { cursor: string };
    assert.equal(state.cursor, prior);

    await importDlsitePayload(db, lateLowChunk, async () => null, 2, {
      advanceCursor: false,
    });
    state = db
      .prepare("SELECT cursor FROM sync_state WHERE source = 'dlsite'")
      .get() as { cursor: string };
    assert.equal(state.cursor, prior);

    commitDlsiteCursor(db, "2024-12-01T00:00:00.000Z");
    state = db
      .prepare("SELECT cursor FROM sync_state WHERE source = 'dlsite'")
      .get() as { cursor: string };
    assert.equal(state.cursor, "2024-12-01T00:00:00.000Z");
  });
});
