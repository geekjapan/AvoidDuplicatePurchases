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
  anyImportsMayHavePersisted,
  combineFullSyncError,
} from "../alarms.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const okSource = { ok: true as const, counts: { inserted: 1, updated: 0 }, fetched: 1 };
const failedSource = (error: string) => ({ ok: false as const, error });

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

  it("runFullSync rematches once when one source fails after another succeeds", async () => {
    let rematchCalls = 0;
    const persisted: Array<{ ok: boolean; error?: string }> = [];
    const outcome = await runFullSync({
      runDlsite: async () => ({ ok: true, counts: { inserted: 1, updated: 0 }, fetched: 1 }),
      runFanza: async () => ({
        fanza_doujin: { ok: false, error: "http_403" },
        fanza_books: { ok: true, counts: { inserted: 0, updated: 0 }, fetched: 0 },
        fanza_video: { ok: true, counts: { inserted: 0, updated: 0 }, fetched: 0 },
        fanza_dlsoft: { ok: true, counts: { inserted: 0, updated: 0 }, fetched: 0 },
      }),
      rematch: async () => {
        rematchCalls++;
        return true;
      },
      persistOutcomes: async (full) => {
        persisted.push({ ok: full.ok, error: full.error });
      },
    });
    assert.equal(rematchCalls, 1);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, "http_403");
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0]?.error, "http_403");
    assert.deepEqual(Object.keys(outcome.sources), [
      "dlsite",
      "fanza_doujin",
      "fanza_books",
      "fanza_video",
      "fanza_dlsoft",
    ]);
  });

  it("runFullSync still records FANZA outcomes and rematches when DLsite fails", async () => {
    let rematched = false;
    const outcome = await runFullSync({
      runDlsite: async () => ({ ok: false, error: "dlsite_failed" }),
      runFanza: async () => ({
        fanza_doujin: { ok: true, counts: { inserted: 1, updated: 0 }, fetched: 1 },
        fanza_books: { ok: true, counts: { inserted: 1, updated: 0 }, fetched: 1 },
        fanza_video: { ok: true, counts: { inserted: 1, updated: 0 }, fetched: 1 },
        fanza_dlsoft: { ok: true, counts: { inserted: 1, updated: 0 }, fetched: 1 },
      }),
      rematch: async () => {
        rematched = true;
        return true;
      },
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, "dlsite_failed");
    assert.equal(rematched, true);
    assert.equal(Object.keys(outcome.sources).length, 5);
  });

  it("skips rematch when no imports may have persisted (all-source catastrophic)", async () => {
    let rematched = false;
    const outcome = await runFullSync({
      runDlsite: async () => ({ ok: false, error: "dlsite_failed" }),
      runFanza: async () => ({
        fanza_doujin: failedSource("http_403"),
        fanza_books: failedSource("network"),
        fanza_video: failedSource("http_500"),
        fanza_dlsoft: failedSource("network"),
      }),
      rematch: async () => {
        rematched = true;
        return true;
      },
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, "dlsite_failed");
    assert.equal(rematched, false);
  });

  it("combines source error with rematch failure deterministically", async () => {
    const outcome = await runFullSync({
      runDlsite: async () => okSource,
      runFanza: async () => ({
        fanza_doujin: failedSource("http_403"),
        fanza_books: okSource,
        fanza_video: okSource,
        fanza_dlsoft: okSource,
      }),
      rematch: async () => false,
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, "http_403+rematch_failed");
  });

  it("reports rematch_failed alone when sources succeed", async () => {
    const outcome = await runFullSync({
      runDlsite: async () => okSource,
      runFanza: async () => ({
        fanza_doujin: okSource,
        fanza_books: okSource,
        fanza_video: okSource,
        fanza_dlsoft: okSource,
      }),
      rematch: async () => false,
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, "rematch_failed");
  });

  it("anyImportsMayHavePersisted treats partial counts and success as importable", () => {
    assert.equal(
      anyImportsMayHavePersisted({
        dlsite: { ok: false, error: "x", counts: { inserted: 2, updated: 0 } },
      }),
      true,
    );
    assert.equal(anyImportsMayHavePersisted({ dlsite: okSource }), true);
    assert.equal(
      anyImportsMayHavePersisted({ dlsite: { ok: false, error: "x" } }),
      false,
    );
  });

  it("combineFullSyncError keeps source error primary and is deterministic", () => {
    assert.equal(combineFullSyncError("http_403", true), "http_403+rematch_failed");
    assert.equal(combineFullSyncError("http_403", false), "http_403");
    assert.equal(combineFullSyncError(undefined, true), "rematch_failed");
    assert.equal(combineFullSyncError(undefined, false), undefined);
  });

  it("shares one in-flight store sequence between manual and alarm entrypoints", async () => {
    let dlsiteRuns = 0;
    let fanzaRuns = 0;
    let rematchRuns = 0;
    let releaseFanza!: () => void;
    let fanzaStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      fanzaStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseFanza = resolve;
    });
    const deps = {
      runDlsite: async () => {
        dlsiteRuns++;
        return { ok: true, counts: { inserted: 0, updated: 0 }, fetched: 1 };
      },
      runFanza: async () => {
        fanzaRuns++;
        fanzaStarted();
        await gate;
        return {
          fanza_doujin: { ok: true, counts: { inserted: 0, updated: 0 }, fetched: 1 },
          fanza_books: { ok: true, counts: { inserted: 0, updated: 0 }, fetched: 1 },
          fanza_video: { ok: true, counts: { inserted: 0, updated: 0 }, fetched: 1 },
          fanza_dlsoft: { ok: true, counts: { inserted: 0, updated: 0 }, fetched: 1 },
        };
      },
      rematch: async () => {
        rematchRuns++;
        return true;
      },
      persistOutcomes: async () => undefined,
    };

    const manual = runFullSync(deps);
    await started;
    const alarmFinished = new Promise<void>((resolve) => {
      handleDailySyncAlarm({ name: DAILY_SYNC_ALARM }, () =>
        runFullSync(deps).then(() => resolve()),
      );
    });
    releaseFanza();
    await manual;
    await alarmFinished;
    assert.equal(dlsiteRuns, 1);
    assert.equal(fanzaRuns, 1);
    assert.equal(rematchRuns, 1);
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

  it("handleDailySyncAlarm does not surface unhandled rejection when sync rejects", async () => {
    let unhandled = 0;
    const onUnhandled = () => {
      unhandled++;
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      handleDailySyncAlarm({ name: DAILY_SYNC_ALARM }, async () => {
        throw new Error("synthetic_sync_rejection");
      });
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(unhandled, 0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
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

  it("registerAlarms keeps an existing daily alarm schedule", async () => {
    const previousChrome = globalThis.chrome;
    let getCalls = 0;
    let createCalls = 0;
    globalThis.chrome = {
      alarms: {
        get: async (name: string) => {
          getCalls++;
          return { name, scheduledTime: 1, periodInMinutes: 1440 };
        },
        create: () => {
          createCalls++;
        },
        onAlarm: { addListener: () => undefined },
      },
    } as unknown as typeof chrome;
    try {
      await registerAlarms();
      assert.equal(getCalls, 1);
      assert.equal(createCalls, 0);
    } finally {
      globalThis.chrome = previousChrome;
    }
  });
});
