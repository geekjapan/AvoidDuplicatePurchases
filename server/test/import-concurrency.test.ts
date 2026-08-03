import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { openDatabase } from "../src/db.js";
import { importDlsitePayload, PRODUCT_FETCH_CONCURRENCY } from "../src/services/import.js";
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
});
