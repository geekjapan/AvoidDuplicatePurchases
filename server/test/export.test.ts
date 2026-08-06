import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { DatabaseSync, type DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { openDatabase } from "../src/db.js";
import { handleApi } from "../src/http.js";
import { persistAdminSettings } from "../src/routes/settings.js";
import "../src/routes/settings.js";
import "../src/export/route.js";
import {
  EXPORT_FILENAME,
  exportSnapshot,
} from "../src/export/export.js";
import { installAutoExport } from "../src/export/auto.js";
import {
  clearSyncSuccessListeners,
  dispatchSyncSuccess,
  subscribeSyncSuccess,
} from "../src/hooks/sync-success.js";
import {
  getLatestSyncOutcomeRecord,
  persistSyncOutcome,
} from "../src/import/fanza/common.js";
import { startServer } from "../src/static.js";

const TEST_EXTENSION_ORIGIN = "chrome-extension://test-extension";
const TEST_EXTENSION_ORIGINS = new Set([TEST_EXTENSION_ORIGIN]);
const AUTO_EXPORT_SOURCE = "full_sync";
const __dirname = fileURLToPath(new URL(".", import.meta.url));

/** Use realpath'd tmp base so symlink-ancestor checks accept test paths on macOS. */
function realTmp(): string {
  return realpathSync(tmpdir());
}

function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  origin: string | null = TEST_EXTENSION_ORIGIN,
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    import("node:http").then(({ request: httpRequest }) => {
      const r = httpRequest(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method,
          headers: {
            ...(origin !== null ? { Origin: origin } : {}),
            ...(payload !== undefined
              ? {
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(payload),
                }
              : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            resolve({ status: res.statusCode ?? 0, json: text.length ? JSON.parse(text) : null });
          });
        },
      );
      r.on("error", reject);
      if (payload !== undefined) r.write(payload);
      r.end();
    });
  });
}

function startTestServer(db: DatabaseSyncType): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    let listenPort = 41321;
    const server = createServer(async (req, res) => {
      await handleApi(req, res, {
        db,
        port: listenPort,
        extensionOrigins: TEST_EXTENSION_ORIGINS,
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      listenPort = typeof addr === "object" && addr ? addr.port : listenPort;
      resolve({ server, port: listenPort });
    });
    server.on("error", reject);
  });
}

function seedListings(db: DatabaseSyncType): void {
  db.exec("INSERT INTO work (id) VALUES (1), (2)");
  db.exec(
    `INSERT INTO listing (id, source, cid, work_id, title, raw_json, imported_at) VALUES
       (1, 'dlsite', 'RJ000001', 1, 'alpha', '{}', '2026-01-01T00:00:00.000Z'),
       (2, 'fanza_doujin', 'd_123456', 2, 'beta', '{}', '2026-01-01T00:00:00.000Z')`,
  );
}

function countListings(path: string): number {
  const ro = new DatabaseSync(path, { readOnly: true });
  try {
    const row = ro.prepare("SELECT COUNT(*) AS c FROM listing").get() as { c: number };
    return row.c;
  } finally {
    ro.close();
  }
}

function snapshotPath(dest: string): string {
  return join(dest, EXPORT_FILENAME);
}

function tempResidue(dest: string): string[] {
  return readdirSync(dest).filter(
    (name) => name.startsWith(".adp-export-") || name.endsWith(".tmp") || name === `${EXPORT_FILENAME}.tmp`,
  );
}

function posixModeBits(path: string): number {
  return lstatSync(path).mode & 0o777;
}

function fullSyncOk(
  db: DatabaseSyncType,
  counts: { inserted: number; updated: number } = { inserted: 1, updated: 0 },
): void {
  persistSyncOutcome(db, AUTO_EXPORT_SOURCE, {
    ok: true,
    counts,
    fetched: counts.inserted + counts.updated,
  });
}

describe("manual export", () => {
  let server: Server;
  let port: number;
  let db: DatabaseSyncType;
  let dest: string;

  before(async () => {
    db = openDatabase(":memory:").sqlite;
    seedListings(db);
    dest = mkdtempSync(join(realTmp(), "adp-export-manual-"));
    persistAdminSettings(db, { port: 41321, exportDestination: dest }, new Date().toISOString());
    const started = await startTestServer(db);
    server = started.server;
    port = started.port;
  });

  after(() => {
    server.close();
    db.close();
  });

  it("writes a readable snapshot with matching listing counts", async () => {
    const res = await request(port, "POST", "/api/export", { destination: dest });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { path: snapshotPath(dest) });
    assert.ok(existsSync(snapshotPath(dest)));
    assert.equal(countListings(snapshotPath(dest)), 2);
    assert.deepEqual(tempResidue(dest), []);
  });

  it("overwrites the previous snapshot on a second export", async () => {
    const first = await request(port, "POST", "/api/export", { destination: dest });
    assert.equal(first.status, 200);
    const second = await request(port, "POST", "/api/export", { destination: dest });
    assert.equal(second.status, 200);
    assert.equal(countListings(snapshotPath(dest)), 2);
    assert.deepEqual(tempResidue(dest), []);
  });

  it("escapes quotes in the destination path via parameterized VACUUM", async () => {
    const quoted = mkdtempSync(join(realTmp(), "adp-export-quote-")) + "/o'quote";
    persistAdminSettings(db, { port: 41321, exportDestination: quoted }, new Date().toISOString());
    const res = await request(port, "POST", "/api/export", { destination: quoted });
    assert.equal(res.status, 200);
    assert.ok(existsSync(snapshotPath(quoted)));
    assert.equal(countListings(snapshotPath(quoted)), 2);
    assert.deepEqual(tempResidue(quoted), []);
  });

  it("rejects a destination that does not match the configured one", async () => {
    const other = mkdtempSync(join(realTmp(), "adp-export-other-"));
    const res = await request(port, "POST", "/api/export", { destination: other });
    assert.equal(res.status, 400);
    assert.deepEqual(res.json, { error: "invalid_request" });
  });

  it("rejects export when no destination is configured", async () => {
    persistAdminSettings(db, { port: 41321, exportDestination: "" }, new Date().toISOString());
    const res = await request(port, "POST", "/api/export", { destination: "" });
    assert.equal(res.status, 400);
    assert.deepEqual(res.json, { error: "invalid_request" });
  });
});

describe("auto export via sync-success hook", () => {
  after(() => {
    clearSyncSuccessListeners();
  });

  it("exports to the configured destination after a successful full_sync", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(realTmp(), "adp-export-auto-"));
    persistAdminSettings(db, { port: 41321, exportDestination: dest }, new Date().toISOString());
    let calls = 0;
    const unsubscribe = installAutoExport(db, 41321, {
      exportSnapshot: (d, destination) => {
        calls += 1;
        return exportSnapshot(d, destination);
      },
    });

    fullSyncOk(db);
    assert.equal(calls, 1);
    assert.ok(existsSync(snapshotPath(dest)));
    assert.equal(countListings(snapshotPath(dest)), 2);

    unsubscribe();
    db.close();
  });

  it("does not export after a failed full_sync", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(realTmp(), "adp-export-fail-"));
    persistAdminSettings(db, { port: 41321, exportDestination: dest }, new Date().toISOString());
    let calls = 0;
    const unsubscribe = installAutoExport(db, 41321, {
      exportSnapshot: (d, destination) => {
        calls += 1;
        return exportSnapshot(d, destination);
      },
    });

    persistSyncOutcome(db, AUTO_EXPORT_SOURCE, {
      ok: false,
      error: "synthetic",
      counts: { inserted: 0, updated: 0 },
    });
    assert.equal(calls, 0);
    assert.ok(!existsSync(snapshotPath(dest)));

    unsubscribe();
    db.close();
  });

  it("does not export on partial source success (fanza_doujin)", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(realTmp(), "adp-export-partial-"));
    persistAdminSettings(db, { port: 41321, exportDestination: dest }, new Date().toISOString());
    let calls = 0;
    const unsubscribe = installAutoExport(db, 41321, {
      exportSnapshot: (d, destination) => {
        calls += 1;
        return exportSnapshot(d, destination);
      },
    });

    persistSyncOutcome(db, "fanza_doujin", {
      ok: true,
      counts: { inserted: 1, updated: 0 },
    });
    assert.equal(calls, 0);
    assert.ok(!existsSync(snapshotPath(dest)));

    unsubscribe();
    db.close();
  });

  it("exports at most once per successful full_sync syncId (duplicate payload)", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(realTmp(), "adp-export-dedupe-"));
    persistAdminSettings(db, { port: 41321, exportDestination: dest }, new Date().toISOString());
    let calls = 0;
    const unsubscribe = installAutoExport(db, 41321, {
      exportSnapshot: (d, destination) => {
        calls += 1;
        return exportSnapshot(d, destination);
      },
    });

    const recordedAt = "2026-08-06T00:00:00.000Z";
    persistSyncOutcome(
      db,
      AUTO_EXPORT_SOURCE,
      { ok: true, counts: { inserted: 1, updated: 0 }, fetched: 1 },
      recordedAt,
    );
    assert.equal(calls, 1);
    const record = getLatestSyncOutcomeRecord(db, AUTO_EXPORT_SOURCE);
    assert.ok(record?.syncId);
    assert.ok(record?.originInstanceId);

    // Duplicate module-global dispatch of the same payload must not re-export.
    dispatchSyncSuccess({
      source: AUTO_EXPORT_SOURCE,
      originInstanceId: record!.originInstanceId,
      outcome: {
        ok: true,
        counts: { inserted: 1, updated: 0 },
        error: null,
        fetched: 1,
        recordedAt,
        syncId: record!.syncId,
      },
    });
    assert.equal(calls, 1);

    unsubscribe();
    db.close();
  });

  it("exports twice for distinct full_sync at the same recordedAt (syncId collision-free)", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(realTmp(), "adp-export-collision-"));
    persistAdminSettings(db, { port: 41321, exportDestination: dest }, new Date().toISOString());
    let calls = 0;
    const unsubscribe = installAutoExport(db, 41321, {
      exportSnapshot: (d, destination) => {
        calls += 1;
        return exportSnapshot(d, destination);
      },
    });

    const sameRecordedAt = "2026-08-06T12:00:00.000Z";
    persistSyncOutcome(
      db,
      AUTO_EXPORT_SOURCE,
      { ok: true, counts: { inserted: 1, updated: 0 }, fetched: 1 },
      sameRecordedAt,
    );
    const first = getLatestSyncOutcomeRecord(db, AUTO_EXPORT_SOURCE);
    assert.ok(first?.syncId);

    persistSyncOutcome(
      db,
      AUTO_EXPORT_SOURCE,
      { ok: true, counts: { inserted: 2, updated: 0 }, fetched: 2 },
      sameRecordedAt,
    );
    const second = getLatestSyncOutcomeRecord(db, AUTO_EXPORT_SOURCE);
    assert.ok(second?.syncId);
    assert.notEqual(first!.syncId, second!.syncId);
    assert.equal(first!.recordedAt, second!.recordedAt);
    assert.equal(calls, 2);

    unsubscribe();
    db.close();
  });

  it("skips export when no destination is configured", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(realTmp(), "adp-export-nodest-"));
    persistAdminSettings(db, { port: 41321, exportDestination: "" }, new Date().toISOString());
    let calls = 0;
    const unsubscribe = installAutoExport(db, 41321, {
      exportSnapshot: () => {
        calls += 1;
        return { path: snapshotPath(dest) };
      },
    });

    fullSyncOk(db);
    assert.equal(calls, 0);
    assert.ok(!existsSync(snapshotPath(dest)));

    unsubscribe();
    db.close();
  });

  it("isolates cross-instance events: foreign DB full_sync does not export local dest", () => {
    const local = openDatabase(":memory:").sqlite;
    const foreign = openDatabase(":memory:").sqlite;
    seedListings(local);
    seedListings(foreign);
    const destLocal = mkdtempSync(join(realTmp(), "adp-export-iso-local-"));
    const destForeign = mkdtempSync(join(realTmp(), "adp-export-iso-foreign-"));
    persistAdminSettings(local, { port: 41321, exportDestination: destLocal }, new Date().toISOString());
    persistAdminSettings(foreign, { port: 41322, exportDestination: destForeign }, new Date().toISOString());

    let localCalls = 0;
    let foreignCalls = 0;
    const unsubLocal = installAutoExport(local, 41321, {
      exportSnapshot: (d, destination) => {
        localCalls += 1;
        return exportSnapshot(d, destination);
      },
    });
    const unsubForeign = installAutoExport(foreign, 41322, {
      exportSnapshot: (d, destination) => {
        foreignCalls += 1;
        return exportSnapshot(d, destination);
      },
    });

    // Only foreign persists — local listener sees the event but must not export.
    fullSyncOk(foreign, { inserted: 2, updated: 0 });
    assert.equal(foreignCalls, 1);
    assert.equal(localCalls, 0);
    assert.ok(existsSync(snapshotPath(destForeign)));
    assert.ok(!existsSync(snapshotPath(destLocal)));

    unsubLocal();
    unsubForeign();
    local.close();
    foreign.close();
  });

  it("does not replay an identical outcome that predates listener installation", () => {
    const local = openDatabase(":memory:").sqlite;
    const foreign = openDatabase(":memory:").sqlite;
    seedListings(local);
    seedListings(foreign);
    const destLocal = mkdtempSync(join(realTmp(), "adp-export-stale-local-"));
    const destForeign = mkdtempSync(join(realTmp(), "adp-export-stale-foreign-"));
    persistAdminSettings(local, { port: 41321, exportDestination: destLocal }, "2026-01-01T00:00:00Z");
    persistAdminSettings(foreign, { port: 41322, exportDestination: destForeign }, "2026-01-01T00:00:00Z");

    const oldRecordedAt = "2026-08-06T01:00:00.000Z";
    for (const db of [local, foreign]) {
      persistSyncOutcome(
        db,
        AUTO_EXPORT_SOURCE,
        { ok: true, counts: { inserted: 1, updated: 0 }, fetched: 1 },
        oldRecordedAt,
      );
    }
    const staleLocal = getLatestSyncOutcomeRecord(local, AUTO_EXPORT_SOURCE);
    const staleForeign = getLatestSyncOutcomeRecord(foreign, AUTO_EXPORT_SOURCE);
    assert.ok(staleLocal && staleForeign);

    let localCalls = 0;
    let foreignCalls = 0;
    const unsubLocal = installAutoExport(local, 41321, {
      exportSnapshot: () => {
        localCalls += 1;
        return { path: snapshotPath(destLocal) };
      },
    });
    const unsubForeign = installAutoExport(foreign, 41322, {
      exportSnapshot: () => {
        foreignCalls += 1;
        return { path: snapshotPath(destForeign) };
      },
    });

    // Replaying pre-install outcomes (including their origin ids) must not export:
    // install rebinds origin, so origin proof fails.
    dispatchSyncSuccess({
      source: AUTO_EXPORT_SOURCE,
      originInstanceId: staleLocal!.originInstanceId,
      outcome: {
        ok: true,
        counts: { inserted: 1, updated: 0 },
        error: null,
        fetched: 1,
        recordedAt: oldRecordedAt,
        syncId: staleLocal!.syncId,
      },
    });
    dispatchSyncSuccess({
      source: AUTO_EXPORT_SOURCE,
      originInstanceId: staleForeign!.originInstanceId,
      outcome: {
        ok: true,
        counts: { inserted: 1, updated: 0 },
        error: null,
        fetched: 1,
        recordedAt: oldRecordedAt,
        syncId: staleForeign!.syncId,
      },
    });
    assert.equal(localCalls, 0);
    assert.equal(foreignCalls, 0);

    persistSyncOutcome(
      foreign,
      AUTO_EXPORT_SOURCE,
      { ok: true, counts: { inserted: 2, updated: 0 }, fetched: 2 },
      "2026-08-06T01:00:01.000Z",
    );
    assert.equal(localCalls, 0);
    assert.equal(foreignCalls, 1);

    unsubLocal();
    unsubForeign();
    local.close();
    foreign.close();
  });

  it("cleans staged residue when post-staging identity validation fails", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const root = mkdtempSync(join(realTmp(), "adp-export-stage-gap-"));
    const dest = mkdtempSync(join(root, "dest-"));
    const outside = join(root, "outside-secret.sqlite");
    writeFileSync(outside, "SECRET");
    const first = exportSnapshot(db, dest);
    const before = readFileSync(first.path);

    assert.throws(
      () =>
        exportSnapshot(db, dest, {
          afterStage: (stagedFile) => {
            // Adversary replaces the staged inode after rename.
            // stagedIdentity was pinned pre-rename so cleanup must still run.
            rmSync(stagedFile, { force: true });
            symlinkSync(outside, stagedFile);
          },
        }),
      /identity changed|replaced|symbolic link|escaped|revalidation|staged/,
    );

    assert.equal(readFileSync(outside, "utf8"), "SECRET");
    assert.deepEqual(readFileSync(first.path), before);
    assert.deepEqual(tempResidue(dest), []);
    const extras = readdirSync(dest).filter((n) => n !== EXPORT_FILENAME);
    assert.deepEqual(extras, []);
    db.close();
  });
});

describe("exportSnapshot service", () => {
  it("rejects a relative destination before resolving it", () => {
    const db = openDatabase(":memory:").sqlite;
    assert.throws(() => exportSnapshot(db, "relative/export"), /must be absolute/);
    db.close();
  });

  it("accepts the platform temp path without requiring callers to realpath system aliases", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(tmpdir(), "adp-export-system-alias-"));
    const result = exportSnapshot(db, dest);
    assert.equal(result.path, snapshotPath(dest));
    assert.equal(countListings(result.path), 2);
    db.close();
  });

  it("writes directly (service seam, quote escaping round-trip)", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(realTmp(), "adp-export-svc-")) + "/a'b";
    const result = exportSnapshot(db, dest);
    assert.equal(result.path, join(dest, EXPORT_FILENAME));
    assert.equal(countListings(result.path), 2);
    assert.deepEqual(tempResidue(dest), []);
    db.close();
  });

  it("cleans temp and preserves existing target when VACUUM fails", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(realTmp(), "adp-export-vacfail-"));
    const first = exportSnapshot(db, dest);
    const before = readFileSync(first.path);

    db.close(); // closed DB → VACUUM INTO must fail
    assert.throws(() => exportSnapshot(db, dest));

    assert.ok(existsSync(first.path));
    assert.deepEqual(readFileSync(first.path), before);
    assert.deepEqual(tempResidue(dest), []);
  });

  it("cleans temp and preserves existing target when rename fails", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(realTmp(), "adp-export-renamefail-"));
    const first = exportSnapshot(db, dest);
    const before = readFileSync(first.path);

    assert.throws(() =>
      exportSnapshot(db, dest, {
        renameSync: () => {
          throw Object.assign(new Error("injected rename failure"), { code: "EACCES" });
        },
      }),
    );

    assert.ok(existsSync(first.path));
    assert.deepEqual(readFileSync(first.path), before);
    assert.deepEqual(tempResidue(dest), []);
    db.close();
  });

  it("cleans residual temp when afterVacuum injects a mid-flight failure", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(realTmp(), "adp-export-midfail-"));
    const first = exportSnapshot(db, dest);
    const before = readFileSync(first.path);

    assert.throws(() =>
      exportSnapshot(db, dest, {
        afterVacuum: () => {
          throw new Error("injected after vacuum");
        },
      }),
    );

    assert.ok(existsSync(first.path));
    assert.deepEqual(readFileSync(first.path), before);
    assert.deepEqual(tempResidue(dest), []);
    db.close();
  });

  it("surfaces cleanup failure via AggregateError (VACUUM ok path residual)", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(realTmp(), "adp-export-cleanup-agg-"));
    const first = exportSnapshot(db, dest);
    const before = readFileSync(first.path);

    assert.throws(
      () =>
        exportSnapshot(db, dest, {
          renameSync: () => {
            throw Object.assign(new Error("injected rename failure"), { code: "EACCES" });
          },
          rmSync: (path, options) => {
            if (options?.recursive) {
              rmSync(path, options);
              return;
            }
            throw Object.assign(new Error("injected cleanup failure"), { code: "EPERM" });
          },
        }),
      (err: unknown) => {
        assert.ok(err instanceof AggregateError, "expected AggregateError");
        const messages = err.errors.map((e) => (e instanceof Error ? e.message : String(e)));
        assert.ok(messages.some((m) => m.includes("injected rename failure")));
        assert.ok(messages.some((m) => m.includes("injected cleanup failure")));
        return true;
      },
    );

    assert.ok(existsSync(first.path));
    assert.deepEqual(readFileSync(first.path), before);
    for (const name of tempResidue(dest)) {
      rmSync(join(dest, name), { recursive: true, force: true });
    }
    db.close();
  });

  it("surfaces cleanup failure before rename and preserves the existing target", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(realTmp(), "adp-export-cleanup-only-"));
    const first = exportSnapshot(db, dest);
    const before = readFileSync(first.path);

    db.exec(
      `INSERT INTO work (id) VALUES (3);
       INSERT INTO listing (id, source, cid, work_id, title, raw_json, imported_at)
       VALUES (3, 'dlsite', 'RJ000003', 3, 'gamma', '{}', '2026-01-01T00:00:00.000Z')`,
    );

    assert.throws(
      () =>
        exportSnapshot(db, dest, {
          rmSync: () => {
            throw Object.assign(new Error("cleanup residual failure"), { code: "EBUSY" });
          },
        }),
      /cleanup residual failure|AggregateError|export failed with cleanup/,
    );

    assert.deepEqual(readFileSync(snapshotPath(dest)), before);
    assert.equal(countListings(snapshotPath(dest)), 2);
    // The error explicitly reports any residual; clean it after asserting target safety.
    for (const name of tempResidue(dest)) {
      rmSync(join(dest, name), { recursive: true, force: true });
    }
    db.close();
  });

  it("surfaces cleanup verification errors and preserves the existing target", () => {
    if (process.platform === "win32") return;
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(realTmp(), "adp-export-cleanup-probe-"));
    const first = exportSnapshot(db, dest);
    const before = readFileSync(first.path);

    try {
      assert.throws(
        () =>
          exportSnapshot(db, dest, {
            rmSync: (path, options) => {
              rmSync(path, options);
              chmodSync(dest, 0o000);
            },
          }),
        (error: unknown) => {
          const errors = error instanceof AggregateError ? error.errors : [error];
          assert.ok(
            errors.some((item) =>
              /cleanup verification failed/.test(
                item instanceof Error ? item.message : String(item),
              ),
            ),
          );
          return true;
        },
      );
    } finally {
      chmodSync(dest, 0o700);
    }

    assert.deepEqual(readFileSync(snapshotPath(dest)), before);
    for (const name of tempResidue(dest)) {
      rmSync(join(dest, name), { recursive: true, force: true });
    }
    db.close();
  });

  it("refuses a destination directory that is a symlink (no write-outside)", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const root = mkdtempSync(join(realTmp(), "adp-export-symlink-dest-"));
    const outside = mkdtempSync(join(root, "outside-"));
    const link = join(root, "link-dest");
    symlinkSync(outside, link);

    assert.throws(() => exportSnapshot(db, link), /symbolic link/);
    assert.deepEqual(readdirSync(outside), []);
    db.close();
  });

  it("refuses a pre-existing target symlink and does not replace the outside file", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(realTmp(), "adp-export-symlink-tgt-"));
    const outside = join(dest, "outside-secret.sqlite");
    writeFileSync(outside, "SECRET-OUTSIDE");
    const target = snapshotPath(dest);
    symlinkSync(outside, target);

    assert.throws(() => exportSnapshot(db, dest), /symbolic link/);
    assert.equal(readFileSync(outside, "utf8"), "SECRET-OUTSIDE");
    assert.ok(lstatSync(target).isSymbolicLink());
    assert.deepEqual(tempResidue(dest), []);
    db.close();
  });

  it("refuses a symlink parent (ancestor component) and leaves outside sentinel intact", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const root = mkdtempSync(join(realTmp(), "adp-export-symlink-parent-"));
    const outside = mkdtempSync(join(root, "outside-"));
    const sentinel = join(outside, "SENTINEL");
    writeFileSync(sentinel, "UNTOUCHED");
    const parentLink = join(root, "parent-link");
    symlinkSync(outside, parentLink);
    const dest = join(parentLink, "sync-folder");

    assert.throws(() => exportSnapshot(db, dest), /symbolic link/);
    assert.equal(readFileSync(sentinel, "utf8"), "UNTOUCHED");
    assert.deepEqual(
      readdirSync(outside).filter((n) => n !== "SENTINEL"),
      [],
    );
    db.close();
  });

  it("fails closed when destination is swapped after pin (TOCTOU)", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const root = mkdtempSync(join(realTmp(), "adp-export-dest-swap-"));
    const dest = join(root, "dest");
    mkdirSync(dest);
    const outside = mkdtempSync(join(root, "outside-"));
    const sentinel = join(outside, "SENTINEL");
    writeFileSync(sentinel, "UNTOUCHED");
    const first = exportSnapshot(db, dest);
    const before = readFileSync(first.path);

    assert.throws(
      () =>
        exportSnapshot(db, dest, {
          afterPin: () => {
            // Replace destination directory with a symlink to outside.
            rmSync(dest, { recursive: true, force: true });
            symlinkSync(outside, dest);
          },
        }),
      /symbolic link|replaced|revalidation/,
    );

    assert.equal(readFileSync(sentinel, "utf8"), "UNTOUCHED");
    // Outside must not gain an export snapshot.
    assert.ok(!existsSync(snapshotPath(outside)));
    // If original dest path is now a symlink, previous file is gone — that is
    // the adversarial swap. Sentinel / outside content is the invariant.
    void before;
    db.close();
  });

  it("fails closed when temp file is swapped for a symlink after VACUUM", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const root = mkdtempSync(join(realTmp(), "adp-export-temp-swap-"));
    const dest = mkdtempSync(join(root, "dest-"));
    const outside = join(root, "outside-secret.sqlite");
    writeFileSync(outside, "SECRET");
    const first = exportSnapshot(db, dest);
    const before = readFileSync(first.path);

    assert.throws(
      () =>
        exportSnapshot(db, dest, {
          afterVacuum: (tempFile) => {
            rmSync(tempFile, { force: true });
            symlinkSync(outside, tempFile);
          },
        }),
      /symbolic link|replaced|escaped|revalidation/,
    );

    assert.equal(readFileSync(outside, "utf8"), "SECRET");
    assert.ok(existsSync(first.path));
    assert.deepEqual(readFileSync(first.path), before);
    assert.deepEqual(tempResidue(dest), []);
    db.close();
  });

  it("fails closed when temp directory is replaced after creation", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const root = mkdtempSync(join(realTmp(), "adp-export-tempdir-swap-"));
    const dest = mkdtempSync(join(root, "dest-"));
    const outside = mkdtempSync(join(root, "outside-"));
    const sentinel = join(outside, "SENTINEL");
    writeFileSync(sentinel, "UNTOUCHED");

    assert.throws(
      () =>
        exportSnapshot(db, dest, {
          afterTempDir: (tempDir) => {
            rmSync(tempDir, { recursive: true, force: true });
            symlinkSync(outside, tempDir);
          },
        }),
      (error: unknown) => {
        const errors = error instanceof AggregateError ? error.errors : [error];
        assert.ok(
          errors.some((item) =>
            /symbolic link|replaced|escaped|revalidation/.test(
              item instanceof Error ? item.message : String(item),
            ),
          ),
        );
        return true;
      },
    );

    assert.equal(readFileSync(sentinel, "utf8"), "UNTOUCHED");
    assert.deepEqual(tempResidue(dest), []);
    db.close();
  });

  it("parallel production exports leave one valid snapshot and no temp residue", async () => {
    const root = mkdtempSync(join(realTmp(), "adp-export-parallel-"));
    const dbPath = join(root, "source.sqlite");
    const dest = join(root, "sync");
    const db = openDatabase(dbPath);
    seedListings(db.sqlite);
    db.close();
    const worker = join(__dirname, "fixtures", "export-worker.ts");

    const exits = await Promise.all(
      Array.from({ length: 4 }, () =>
        new Promise<{ code: number | null; stderr: string }>((resolve) => {
          const child = spawn(process.execPath, ["--import", "tsx", worker, dbPath, dest], {
            cwd: join(__dirname, ".."),
            stdio: ["ignore", "ignore", "pipe"],
          });
          let stderr = "";
          child.stderr?.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
          });
          child.on("exit", (code) => resolve({ code, stderr }));
        }),
      ),
    );

    assert.ok(exits.some(({ code }) => code === 0), JSON.stringify(exits));
    assert.ok(exits.every(({ code }) => code === 0), JSON.stringify(exits));
    assert.ok(existsSync(snapshotPath(dest)));
    assert.equal(countListings(snapshotPath(dest)), 2);
    assert.deepEqual(tempResidue(dest), []);
  });

  it("does not use a fixed predictable .tmp name that can be raced", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(realTmp(), "adp-export-notmp-"));
    // Plant a competing fixed-name trap (old vulnerability surface).
    const fixedTmp = join(dest, `${EXPORT_FILENAME}.tmp`);
    writeFileSync(fixedTmp, "trap");

    const result = exportSnapshot(db, dest);
    assert.equal(countListings(result.path), 2);
    // Export must not consume/replace via the fixed name as its write path.
    assert.equal(readFileSync(fixedTmp, "utf8"), "trap");
    assert.ok(!lstatSync(result.path).isSymbolicLink());
    db.close();
  });

  it("uses exclusive temp dirs that are removed after success", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(realTmp(), "adp-export-exclusive-"));
    let seenTemp: string | undefined;
    exportSnapshot(db, dest, {
      afterVacuum: (tempFile) => {
        seenTemp = tempFile;
        assert.ok(existsSync(tempFile));
        assert.ok(tempFile.includes(".adp-export-"));
        assert.notEqual(tempFile, snapshotPath(dest));
        assert.notEqual(tempFile, join(dest, `${EXPORT_FILENAME}.tmp`));
      },
    });
    assert.ok(seenTemp);
    assert.ok(!existsSync(seenTemp!));
    assert.deepEqual(tempResidue(dest), []);
    db.close();
  });

  it("applies POSIX 0700/0600 modes on new destination and snapshot (platform-conditional)", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = join(mkdtempSync(join(realTmp(), "adp-export-mode-")), "new-dest");

    const result = exportSnapshot(db, dest);
    if (process.platform === "win32") {
      // Windows: Node mode bits are not a full ACL guarantee — just ensure write works.
      assert.ok(existsSync(result.path));
    } else {
      assert.equal(posixModeBits(dest), 0o700);
      assert.equal(posixModeBits(result.path), 0o600);
    }
    db.close();
  });

  it("does not loosen permissions on a pre-existing destination directory", () => {
    if (process.platform === "win32") {
      // Mode bits are not meaningful the same way on Windows ACLs.
      return;
    }
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(realTmp(), "adp-export-keepmode-"));
    chmodSync(dest, 0o755);
    assert.equal(posixModeBits(dest), 0o755);

    exportSnapshot(db, dest);
    assert.equal(posixModeBits(dest), 0o755, "existing dir mode must not be loosened or rewritten");
    assert.equal(posixModeBits(snapshotPath(dest)), 0o600);
    db.close();
  });
});

describe("production startServer auto-export lifecycle", () => {
  after(() => {
    clearSyncSuccessListeners();
  });

  it("unsubscribes on close so later syncs do not export or touch a closed DB", async () => {
    const dir = mkdtempSync(join(realTmp(), "adp-export-lifecycle-"));
    const dbPath = join(dir, "data.sqlite");
    const dest = mkdtempSync(join(dir, "sync-"));

    const seed = openDatabase(dbPath);
    seedListings(seed.sqlite);
    persistAdminSettings(
      seed.sqlite,
      { port: 41321, exportDestination: dest },
      new Date().toISOString(),
    );
    seed.close();

    const started = startServer({
      env: {
        ADP_DB_PATH: dbPath,
        ADP_EXTENSION_ORIGIN: TEST_EXTENSION_ORIGIN,
      },
      host: "127.0.0.1",
      port: 0,
      listen: true,
      fetchImpl: (async () => new Response(null, { status: 404 })) as typeof fetch,
    });

    try {
      await started.ready;
      const outcome = await request(started.port, "POST", "/api/sync-outcome/full_sync", {
        ok: true,
        counts: { inserted: 1, updated: 0 },
        fetched: 1,
      });
      assert.equal(outcome.status, 200);
      assert.ok(existsSync(snapshotPath(dest)));
      assert.equal(countListings(snapshotPath(dest)), 2);

      // Remove snapshot so a post-close listener leak would recreate it.
      rmSync(snapshotPath(dest), { force: true });
      started.close();
      started.close(); // idempotent double-close

      // Directly open DB and fire success outcome after close — listener must be gone.
      const post = openDatabase(dbPath);
      fullSyncOk(post.sqlite);
      post.close();
      assert.ok(!existsSync(snapshotPath(dest)), "closed server must not auto-export");
    } finally {
      try {
        started.close();
      } catch {
        // already closed
      }
      clearSyncSuccessListeners();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("supports concurrent double-close without throwing", async () => {
    const dir = mkdtempSync(join(realTmp(), "adp-export-dblclose-"));
    const dbPath = join(dir, "data.sqlite");
    openDatabase(dbPath).close();

    const started = startServer({
      env: { ADP_DB_PATH: dbPath },
      host: "127.0.0.1",
      port: 0,
      listen: true,
      fetchImpl: (async () => new Response(null, { status: 404 })) as typeof fetch,
    });
    try {
      await started.ready;
      assert.doesNotThrow(() => {
        started.close();
        started.close();
      });
    } finally {
      try {
        started.close();
      } catch {
        // ignore
      }
      clearSyncSuccessListeners();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the DB open for in-flight requests until server drain completes", async () => {
    const dir = mkdtempSync(join(realTmp(), "adp-export-inflight-"));
    const dbPath = join(dir, "data.sqlite");
    const seed = openDatabase(dbPath);
    seedListings(seed.sqlite);
    seed.close();

    const started = startServer({
      env: {
        ADP_DB_PATH: dbPath,
        ADP_EXTENSION_ORIGIN: TEST_EXTENSION_ORIGIN,
      },
      host: "127.0.0.1",
      port: 0,
      listen: true,
      fetchImpl: (async () => new Response(null, { status: 404 })) as typeof fetch,
    });

    try {
      await started.ready;

      // Hold the socket open without finishing the HTTP response consumption
      // until after close() is requested — drain must keep DB usable.
      const inflight = new Promise<{ status: number }>((resolve, reject) => {
        import("node:http").then(({ request: httpRequest }) => {
          const req = httpRequest(
            {
              hostname: "127.0.0.1",
              port: started.port,
              path: "/api/listings",
              method: "GET",
              headers: { Origin: TEST_EXTENSION_ORIGIN },
            },
            (res) => {
              const chunks: Buffer[] = [];
              res.on("data", (c) => chunks.push(c));
              res.on("end", () => {
                resolve({ status: res.statusCode ?? 0 });
              });
            },
          );
          req.on("error", reject);
          req.end();
        });
      });

      // Yield so the request reaches the handler before we stop listening.
      await new Promise((r) => setTimeout(r, 50));
      started.close();
      const result = await inflight;
      assert.equal(result.status, 200);

      // After drain, further requests must fail (server closed).
      await assert.rejects(
        () => request(started.port, "GET", "/api/listings"),
        (err: unknown) => {
          const code = (err as NodeJS.ErrnoException)?.code;
          return code === "ECONNREFUSED" || code === "ECONNRESET" || code === "EPIPE";
        },
      );
    } finally {
      try {
        started.close();
      } catch {
        // ignore
      }
      clearSyncSuccessListeners();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("cleans up after listen failure without caller close (listener/DB gone)", async () => {
    const dir = mkdtempSync(join(realTmp(), "adp-export-listenfail-"));
    const dbPath = join(dir, "data.sqlite");
    const dest = mkdtempSync(join(dir, "sync-"));
    const seed = openDatabase(dbPath);
    seedListings(seed.sqlite);
    persistAdminSettings(
      seed.sqlite,
      { port: 41321, exportDestination: dest },
      new Date().toISOString(),
    );
    seed.close();

    const blocker = createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = blocker.address();
    const busyPort = typeof addr === "object" && addr ? addr.port : 0;
    assert.ok(busyPort > 0);

    let probeCalls = 0;
    const probeUnsub = subscribeSyncSuccess(() => {
      probeCalls += 1;
    });

    const started = startServer({
      env: { ADP_DB_PATH: dbPath, ADP_EXTENSION_ORIGIN: TEST_EXTENSION_ORIGIN },
      host: "127.0.0.1",
      port: busyPort,
      listen: true,
      fetchImpl: (async () => new Response(null, { status: 404 })) as typeof fetch,
    });

    await assert.rejects(() => started.ready);

    // Caller intentionally does NOT call close — listen-failure path must have
    // already unsubscribed auto-export and closed the DB.
    const beforeProbe = probeCalls;
    const post = openDatabase(dbPath);
    fullSyncOk(post.sqlite);
    post.close();

    // Probe (still subscribed) must fire; auto-export must not create a snapshot.
    assert.ok(probeCalls > beforeProbe, "module dispatch still works for other listeners");
    assert.ok(!existsSync(snapshotPath(dest)), "auto-export listener must be unsubscribed");

    // Idempotent close after automatic cleanup.
    assert.doesNotThrow(() => {
      started.close();
      started.close();
    });

    probeUnsub();
    blocker.close();
    clearSyncSuccessListeners();
    rmSync(dir, { recursive: true, force: true });
  });

  it("multiple startServer instances each export independently and close cleanly", async () => {
    const dir = mkdtempSync(join(realTmp(), "adp-export-multi-"));
    const dbPathA = join(dir, "a.sqlite");
    const dbPathB = join(dir, "b.sqlite");
    const destA = mkdtempSync(join(dir, "sync-a-"));
    const destB = mkdtempSync(join(dir, "sync-b-"));

    for (const [dbPath, dest] of [
      [dbPathA, destA],
      [dbPathB, destB],
    ] as const) {
      const seed = openDatabase(dbPath);
      seedListings(seed.sqlite);
      persistAdminSettings(
        seed.sqlite,
        { port: 41321, exportDestination: dest },
        new Date().toISOString(),
      );
      seed.close();
    }

    const a = startServer({
      env: { ADP_DB_PATH: dbPathA, ADP_EXTENSION_ORIGIN: TEST_EXTENSION_ORIGIN },
      host: "127.0.0.1",
      port: 0,
      listen: true,
      fetchImpl: (async () => new Response(null, { status: 404 })) as typeof fetch,
    });
    const b = startServer({
      env: { ADP_DB_PATH: dbPathB, ADP_EXTENSION_ORIGIN: TEST_EXTENSION_ORIGIN },
      host: "127.0.0.1",
      port: 0,
      listen: true,
      fetchImpl: (async () => new Response(null, { status: 404 })) as typeof fetch,
    });

    try {
      await Promise.all([a.ready, b.ready]);
      assert.notEqual(a.port, b.port);

      const ra = await request(a.port, "POST", "/api/sync-outcome/full_sync", {
        ok: true,
        counts: { inserted: 1, updated: 0 },
      });
      assert.equal(ra.status, 200);
      assert.ok(existsSync(snapshotPath(destA)));
      // Cross-fire must not populate B's destination from A's full_sync.
      assert.ok(!existsSync(snapshotPath(destB)));

      const rb = await request(b.port, "POST", "/api/sync-outcome/full_sync", {
        ok: true,
        counts: { inserted: 1, updated: 0 },
      });
      assert.equal(rb.status, 200);
      assert.ok(existsSync(snapshotPath(destB)));

      a.close();
      b.close();

      rmSync(snapshotPath(destA), { force: true });
      rmSync(snapshotPath(destB), { force: true });

      const postA = openDatabase(dbPathA);
      fullSyncOk(postA.sqlite);
      postA.close();
      assert.ok(!existsSync(snapshotPath(destA)));
      assert.ok(!existsSync(snapshotPath(destB)));
    } finally {
      try {
        a.close();
      } catch {
        // ignore
      }
      try {
        b.close();
      } catch {
        // ignore
      }
      clearSyncSuccessListeners();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("direct production entry exits on EADDRINUSE without unhandled rejection", async () => {
    const dir = mkdtempSync(join(realTmp(), "adp-export-entry-eaddr-"));
    const dbPath = join(dir, "data.sqlite");
    openDatabase(dbPath).close();

    const blocker = createServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = blocker.address();
    const busyPort = typeof addr === "object" && addr ? addr.port : 0;
    assert.ok(busyPort > 0);

    const staticEntry = join(__dirname, "..", "src", "static.ts");
    const child: ChildProcess = spawn(
      process.execPath,
      ["--import", "tsx", staticEntry],
      {
        cwd: join(__dirname, ".."),
        env: {
          ...process.env,
          ADP_DB_PATH: dbPath,
          ADP_PORT: String(busyPort),
          ADP_HOST: "127.0.0.1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const exit = await new Promise<{ code: number | null; output: string }>((resolve) => {
      let output = "";
      child.stdout?.on("data", (c: Buffer) => {
        output += c.toString();
      });
      child.stderr?.on("data", (c: Buffer) => {
        output += c.toString();
      });
      child.on("exit", (code) => resolve({ code, output }));
    });

    assert.notEqual(exit.code, 0, `expected non-zero exit, got ${exit.code}: ${exit.output}`);
    blocker.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
