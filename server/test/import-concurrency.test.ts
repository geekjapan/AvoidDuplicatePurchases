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
