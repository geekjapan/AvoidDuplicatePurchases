import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openDatabase } from "../src/db.js";
import { persistSyncOutcome } from "../src/import/fanza/common.js";
import {
  clearSyncSuccessListeners,
  subscribeSyncSuccess,
} from "../src/hooks/sync-success.js";

describe("sync-success hook", () => {
  it("invokes subscribers only when ok === true", () => {
    clearSyncSuccessListeners();
    const db = openDatabase(":memory:").sqlite;
    const events: string[] = [];
    subscribeSyncSuccess((payload) => {
      events.push(`${payload.source}:${payload.outcome.counts.inserted}`);
    });

    persistSyncOutcome(db, "fanza_doujin", {
      ok: false,
      error: "synthetic",
      counts: { inserted: 1, updated: 0 },
    });
    assert.deepEqual(events, []);

    persistSyncOutcome(db, "fanza_doujin", {
      ok: true,
      counts: { inserted: 2, updated: 3 },
      fetched: 4,
    });
    assert.deepEqual(events, ["fanza_doujin:2"]);
    db.close();
  });

  it("does not let listener failures break persistence", () => {
    clearSyncSuccessListeners();
    const db = openDatabase(":memory:").sqlite;
    subscribeSyncSuccess(() => {
      throw new Error("listener failed");
    });

    assert.doesNotThrow(() =>
      persistSyncOutcome(db, "dlsite", {
        ok: true,
        counts: { inserted: 0, updated: 1 },
      }),
    );

    const row = db
      .prepare("SELECT cursor FROM sync_state WHERE source = ?")
      .get("__sync_outcome__:dlsite") as { cursor: string } | undefined;
    assert.ok(row);
    assert.match(row.cursor, /"ok":true/);
    db.close();
  });
});
