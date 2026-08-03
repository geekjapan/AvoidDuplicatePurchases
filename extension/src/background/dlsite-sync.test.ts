import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  chunkSales,
  DAILY_SYNC_ALARM,
  handleDailySyncAlarm,
  IMPORT_CHUNK_SIZE,
  maxCursorFromSales,
  runDlsiteSync,
  type SyncDeps,
} from "./dlsite-sync.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
      commitDlsiteCursorOnServer: async (cursor) => ({
        ok: true,
        state: { cursor, lastSyncedAt: "2024-01-01T00:00:00.000Z" },
      }),
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
      commitDlsiteCursorOnServer: async (cursor) => ({
        ok: true,
        state: { cursor, lastSyncedAt: "2024-01-01T00:00:00.000Z" },
      }),
      rematchOnServer: async () => true,
    });
    assert.equal(outcome.ok, true);
    assert.deepEqual(outcome.counts, { inserted: 1, updated: 0 });
    assert.equal(outcome.fetched, 1);
  });

  it("computes global max cursor independent of response order", () => {
    const sales = [
      { workno: "RJ000002", sales_date: "2024-06-01T00:00:00.000Z" },
      { workno: "RJ000001", sales_date: "2024-12-31T23:59:59.000Z" },
      { workno: "RJ000003", sales_date: "2023-01-01T00:00:00.000Z" },
    ];
    assert.equal(maxCursorFromSales(sales), "2024-12-31T23:59:59.000Z");
    assert.equal(maxCursorFromSales([...sales].reverse()), "2024-12-31T23:59:59.000Z");
  });

  it("selects later fractional instant over earlier seconds-only ISO (mixed precision)", () => {
    const sales = [
      { workno: "RJ000001", sales_date: "2024-01-01T00:00:00Z" },
      { workno: "RJ000002", sales_date: "2024-01-01T00:00:00.999Z" },
    ];
    assert.equal(maxCursorFromSales(sales), "2024-01-01T00:00:00.999Z");
    assert.equal(maxCursorFromSales([...sales].reverse()), "2024-01-01T00:00:00.999Z");
  });

  it("global cursor path is order-independent for six-digit sub-millisecond fractions", () => {
    const sales = [
      { workno: "RJ000001", sales_date: "2024-01-01T00:00:00.000001Z" },
      { workno: "RJ000002", sales_date: "2024-01-01T00:00:00.000002Z" },
    ];
    assert.equal(maxCursorFromSales(sales), "2024-01-01T00:00:00.000002Z");
    assert.equal(maxCursorFromSales([...sales].reverse()), "2024-01-01T00:00:00.000002Z");
  });

  it("imports chunks without advancing cursor and commits global max once after all succeed", async () => {
    const sales = Array.from({ length: 85 }, (_, i) => {
      const day = String((i % 28) + 1).padStart(2, "0");
      return {
        workno: `RJ${String(i).padStart(6, "0")}`,
        sales_date:
          i === 0
            ? "2024-12-31T23:59:59.000Z"
            : `2024-01-${day}T00:00:00.000Z`,
      };
    });

    const importCalls: Array<{ payload: unknown; options?: { advanceCursor?: boolean } }> =
      [];
    const commits: string[] = [];

    const deps: SyncDeps = {
      getDlsiteSyncState: async () => ({ cursor: "0", lastSyncedAt: null }),
      fetchDlsiteSales: async () => ({ ok: true, sales }),
      importDlsiteOnServer: async (payload, options) => {
        importCalls.push({ payload, options });
        assert.equal(options?.advanceCursor, false);
        return {
          ok: true,
          counts: { inserted: (payload as unknown[]).length, updated: 0 },
        };
      },
      commitDlsiteCursorOnServer: async (cursor) => {
        commits.push(cursor);
        return { ok: true, state: { cursor, lastSyncedAt: "2024-12-31T23:59:59.000Z" } };
      },
      rematchOnServer: async () => true,
    };

    const outcome = await runDlsiteSync(deps);
    assert.equal(outcome.ok, true);
    assert.equal(importCalls.length, 3);
    assert.equal(commits.length, 1);
    assert.equal(commits[0], "2024-12-31T23:59:59.000Z");
    const lastChunk = importCalls[2]!.payload as Array<{ sales_date: string }>;
    assert.ok(lastChunk.every((s) => s.sales_date !== "2024-12-31T23:59:59.000Z"));
  });

  it("commits global max when chunks are ordered reverse-chronologically (max in last chunk)", async () => {
    const sales = [
      ...Array.from({ length: 40 }, (_, i) => ({
        workno: `RJ${String(100000 + i).padStart(6, "0")}`,
        sales_date: "2024-01-01T00:00:00Z",
      })),
      ...Array.from({ length: 40 }, (_, i) => ({
        workno: `RJ${String(200000 + i).padStart(6, "0")}`,
        sales_date: "2024-06-01T00:00:00Z",
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        workno: `RJ${String(300000 + i).padStart(6, "0")}`,
        sales_date:
          i === 4 ? "2024-01-01T00:00:00.999Z" : "2023-01-01T00:00:00Z",
      })),
    ];
    sales[84] = { workno: "RJ300004", sales_date: "2024-12-15T12:00:00.500Z" };

    const commits: string[] = [];
    const outcome = await runDlsiteSync({
      getDlsiteSyncState: async () => ({ cursor: "0", lastSyncedAt: null }),
      fetchDlsiteSales: async () => ({ ok: true, sales }),
      importDlsiteOnServer: async (_payload, options) => {
        assert.equal(options?.advanceCursor, false);
        return { ok: true, counts: { inserted: 1, updated: 0 } };
      },
      commitDlsiteCursorOnServer: async (cursor) => {
        commits.push(cursor);
        return { ok: true, state: { cursor, lastSyncedAt: cursor } };
      },
      rematchOnServer: async () => true,
    });

    assert.equal(outcome.ok, true);
    assert.deepEqual(commits, ["2024-12-15T12:00:00.500Z"]);
    assert.equal(maxCursorFromSales(sales), "2024-12-15T12:00:00.500Z");
    assert.equal(maxCursorFromSales([...sales].reverse()), "2024-12-15T12:00:00.500Z");
  });

  it("does not commit cursor when any import chunk fails", async () => {
    const sales = Array.from({ length: 85 }, (_, i) => ({
      workno: `RJ${String(i).padStart(6, "0")}`,
      sales_date: `2024-06-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    }));

    let importCount = 0;
    const commits: string[] = [];

    const outcome = await runDlsiteSync({
      getDlsiteSyncState: async () => ({ cursor: "prev-cursor", lastSyncedAt: null }),
      fetchDlsiteSales: async () => ({ ok: true, sales }),
      importDlsiteOnServer: async () => {
        importCount++;
        if (importCount === 2) {
          return { ok: false, error: "http_500" };
        }
        return { ok: true, counts: { inserted: 40, updated: 0 } };
      },
      commitDlsiteCursorOnServer: async (cursor) => {
        commits.push(cursor);
        return { ok: true, state: { cursor, lastSyncedAt: null } };
      },
      rematchOnServer: async () => true,
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, "http_500");
    assert.equal(importCount, 2);
    assert.deepEqual(commits, []);
  });

  it("treats initial empty sales history as successful zero-count sync", async () => {
    let importCalls = 0;
    const commits: string[] = [];
    let rematchCalls = 0;

    const outcome = await runDlsiteSync({
      getDlsiteSyncState: async () => ({ cursor: "0", lastSyncedAt: null }),
      fetchDlsiteSales: async () => ({ ok: true, sales: [] }),
      importDlsiteOnServer: async () => {
        importCalls++;
        return { ok: true, counts: { inserted: 1, updated: 0 } };
      },
      commitDlsiteCursorOnServer: async (cursor) => {
        commits.push(cursor);
        return { ok: true, state: { cursor, lastSyncedAt: null } };
      },
      rematchOnServer: async () => {
        rematchCalls++;
        return true;
      },
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.error, undefined);
    assert.deepEqual(outcome.counts, { inserted: 0, updated: 0 });
    assert.equal(outcome.fetched, 0);
    assert.equal(importCalls, 0);
    assert.deepEqual(commits, []);
    assert.equal(rematchCalls, 1);
  });

  it("treats empty incremental sales response as successful zero-count sync without cursor commit", async () => {
    let importCalls = 0;
    const commits: string[] = [];

    const outcome = await runDlsiteSync({
      getDlsiteSyncState: async () => ({
        cursor: "2024-06-01T00:00:00.000Z",
        lastSyncedAt: "2024-06-02T00:00:00.000Z",
      }),
      fetchDlsiteSales: async (last) => {
        assert.equal(last, "2024-06-01T00:00:00.000Z");
        return { ok: true, sales: [] };
      },
      importDlsiteOnServer: async () => {
        importCalls++;
        return { ok: true, counts: { inserted: 1, updated: 0 } };
      },
      commitDlsiteCursorOnServer: async (cursor) => {
        commits.push(cursor);
        return { ok: true, state: { cursor, lastSyncedAt: null } };
      },
      rematchOnServer: async () => true,
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.error, undefined);
    assert.deepEqual(outcome.counts, { inserted: 0, updated: 0 });
    assert.equal(outcome.fetched, 0);
    assert.equal(importCalls, 0);
    assert.deepEqual(commits, []);
  });
});

describe("MV3 service worker alarm static import contract", () => {
  it("background index statically imports alarm handler and never uses dynamic import()", () => {
    const src = readFileSync(join(__dirname, "index.ts"), "utf8");
    // Chrome MV3 extension service workers do not support dynamic import expressions.
    assert.doesNotMatch(src, /\bimport\s*\(\s*["'`]/);
    assert.match(
      src,
      /import\s*\{[^}]*handleDailySyncAlarm[^}]*\}\s*from\s*["']\.\/dlsite-sync\.js["']/,
    );
    assert.match(src, /handleDailySyncAlarm\s*\(\s*alarm\s*\)/);
    assert.match(src, /chrome\.alarms\.onAlarm\.addListener/);
  });

  it("handleDailySyncAlarm invokes sync entrypoint and swallows rejection", async () => {
    let called = 0;
    handleDailySyncAlarm({ name: DAILY_SYNC_ALARM }, async () => {
      called++;
      return { ok: true, counts: { inserted: 0, updated: 0 }, fetched: 0 };
    });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(called, 1);

    let rejectedHandled = false;
    handleDailySyncAlarm({ name: DAILY_SYNC_ALARM }, async () => {
      rejectedHandled = true;
      throw new Error("boom");
    });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(rejectedHandled, true);

    let skipped = 0;
    handleDailySyncAlarm({ name: "other" }, async () => {
      skipped++;
      return { ok: true };
    });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(skipped, 0);
  });
});
