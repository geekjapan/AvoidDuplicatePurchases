import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chunkSales,
  IMPORT_CHUNK_SIZE,
  runDlsiteSync,
  type SyncDeps,
} from "./dlsite-sync.ts";

describe("dlsite-sync chunking and rematch propagation", () => {
  it("splits sales into bounded import chunks", () => {
    const sales = Array.from({ length: 95 }, (_, i) => ({ id: i }));
    const chunks = chunkSales(sales, 40);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0]!.length, 40);
    assert.equal(chunks[1]!.length, 40);
    assert.equal(chunks[2]!.length, 15);
    assert.equal(IMPORT_CHUNK_SIZE, 40);
  });

  it("imports in chunks and reports rematch failure as sync error", async () => {
    const imports: unknown[][] = [];
    const sales = Array.from({ length: 85 }, (_, i) => ({
      workno: `RJ${String(i).padStart(6, "0")}`,
      sales_date: "2024-01-01T00:00:00.000Z",
    }));

    const deps: SyncDeps = {
      getDlsiteSyncState: async () => ({ cursor: "0", lastSyncedAt: null }),
      fetchDlsiteSales: async () => ({ ok: true, sales }),
      importDlsiteOnServer: async (payload) => {
        assert.ok(Array.isArray(payload));
        imports.push(payload as unknown[]);
        return {
          ok: true,
          counts: { inserted: (payload as unknown[]).length, updated: 0 },
        };
      },
      rematchOnServer: async () => false,
    };

    const outcome = await runDlsiteSync(deps);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, "rematch_failed");
    assert.equal(outcome.fetched, 85);
    assert.deepEqual(outcome.counts, { inserted: 85, updated: 0 });
    assert.equal(imports.length, 3);
    assert.equal(imports[0]!.length, 40);
    assert.equal(imports[1]!.length, 40);
    assert.equal(imports[2]!.length, 5);
  });

  it("returns ok with counts when rematch succeeds", async () => {
    const sales = [{ workno: "RJ000001", sales_date: "2024-01-01T00:00:00.000Z" }];
    const outcome = await runDlsiteSync({
      getDlsiteSyncState: async () => null,
      fetchDlsiteSales: async () => ({ ok: true, sales }),
      importDlsiteOnServer: async () => ({
        ok: true,
        counts: { inserted: 1, updated: 0 },
      }),
      rematchOnServer: async () => true,
    });
    assert.equal(outcome.ok, true);
    assert.deepEqual(outcome.counts, { inserted: 1, updated: 0 });
    assert.equal(outcome.fetched, 1);
  });
});
