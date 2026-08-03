import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  DAILY_SYNC_ALARM,
  handleDailySyncAlarm,
  runFullSync,
  registerAlarms,
} from "../alarms.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("alarms full sync", () => {
  it("runFullSync runs DLsite, four FANZA sources, then rematch once", async () => {
    const order: string[] = [];
    const outcome = await runFullSync({
      runDlsite: async () => {
        order.push("dlsite");
        return { ok: true, counts: { inserted: 1, updated: 0 }, fetched: 1 };
      },
      runFanza: async () => {
        order.push("fanza");
        return {
          fanza_doujin: { ok: true, counts: { inserted: 0, updated: 0 }, fetched: 1 },
          fanza_books: { ok: true, counts: { inserted: 0, updated: 0 }, fetched: 2 },
          fanza_video: { ok: true, counts: { inserted: 0, updated: 0 }, fetched: 1 },
          fanza_dlsoft: { ok: true, counts: { inserted: 0, updated: 0 }, fetched: 1 },
        };
      },
      rematch: async () => {
        order.push("rematch");
        return true;
      },
    });

    assert.equal(outcome.ok, true);
    assert.deepEqual(order, ["dlsite", "fanza", "rematch"]);
    assert.equal(Object.keys(outcome.sources).length, 5);
  });

  it("runFullSync stops on first FANZA failure without rematch", async () => {
    let rematched = false;
    const outcome = await runFullSync({
      runDlsite: async () => ({ ok: true, counts: { inserted: 0, updated: 0 }, fetched: 0 }),
      runFanza: async () => ({
        fanza_doujin: { ok: false, error: "http_403" },
        fanza_books: { ok: true, counts: { inserted: 0, updated: 0 }, fetched: 0 },
        fanza_video: { ok: true, counts: { inserted: 0, updated: 0 }, fetched: 0 },
        fanza_dlsoft: { ok: true, counts: { inserted: 0, updated: 0 }, fetched: 0 },
      }),
      rematch: async () => {
        rematched = true;
        return true;
      },
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, "http_403");
    assert.equal(rematched, false);
  });

  it("handleDailySyncAlarm invokes full sync for daily alarm name", async () => {
    let called = 0;
    handleDailySyncAlarm({ name: DAILY_SYNC_ALARM }, async () => {
      called++;
      return { ok: true, sources: {} };
    });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(called, 1);

    let skipped = 0;
    handleDailySyncAlarm({ name: "other" }, async () => {
      skipped++;
      return { ok: true, sources: {} };
    });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(skipped, 0);
  });

  it("background index statically imports registerAlarms and never uses dynamic import()", () => {
    const src = readFileSync(join(__dirname, "index.ts"), "utf8");
    assert.doesNotMatch(src, /\bimport\s*\(\s*["'`]/);
    assert.match(src, /registerAlarms\s*\(\s*\)/);
    assert.doesNotMatch(src, /handleDailySyncAlarm/);
  });

  it("registerAlarms and daily alarm name are defined", () => {
    assert.equal(typeof registerAlarms, "function");
    assert.equal(DAILY_SYNC_ALARM, "adp-daily-sync");
  });
});
