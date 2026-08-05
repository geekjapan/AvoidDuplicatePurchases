import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { DatabaseSync, type DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { openDatabase } from "../src/db.js";
import { handleApi } from "../src/http.js";
import { persistAdminSettings } from "../src/routes/settings.js";
import "../src/routes/settings.js";
import "../src/export/route.js";
import { EXPORT_FILENAME, exportSnapshot } from "../src/export/export.js";
import { installAutoExport } from "../src/export/auto.js";
import { clearSyncSuccessListeners } from "../src/hooks/sync-success.js";
import { persistSyncOutcome } from "../src/import/fanza/common.js";
import { startServer } from "../src/static.js";

const TEST_EXTENSION_ORIGIN = "chrome-extension://test-extension";
const TEST_EXTENSION_ORIGINS = new Set([TEST_EXTENSION_ORIGIN]);

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

describe("manual export", () => {
  let server: Server;
  let port: number;
  let db: DatabaseSyncType;
  let dest: string;

  before(async () => {
    db = openDatabase(":memory:").sqlite;
    seedListings(db);
    dest = mkdtempSync(join(tmpdir(), "adp-export-manual-"));
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
    const quoted = mkdtempSync(join(tmpdir(), "adp-export-quote-")) + "/o'quote";
    persistAdminSettings(db, { port: 41321, exportDestination: quoted }, new Date().toISOString());
    const res = await request(port, "POST", "/api/export", { destination: quoted });
    assert.equal(res.status, 200);
    assert.ok(existsSync(snapshotPath(quoted)));
    assert.equal(countListings(snapshotPath(quoted)), 2);
    assert.deepEqual(tempResidue(quoted), []);
  });

  it("rejects a destination that does not match the configured one", async () => {
    const other = mkdtempSync(join(tmpdir(), "adp-export-other-"));
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

  it("exports to the configured destination after a successful sync", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(tmpdir(), "adp-export-auto-"));
    persistAdminSettings(db, { port: 41321, exportDestination: dest }, new Date().toISOString());
    const unsubscribe = installAutoExport(db, 41321);

    persistSyncOutcome(db, "fanza_doujin", {
      ok: true,
      counts: { inserted: 1, updated: 0 },
      fetched: 1,
    });
    assert.ok(existsSync(snapshotPath(dest)));
    assert.equal(countListings(snapshotPath(dest)), 2);

    unsubscribe();
    db.close();
  });

  it("does not export after a failed sync", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(tmpdir(), "adp-export-fail-"));
    persistAdminSettings(db, { port: 41321, exportDestination: dest }, new Date().toISOString());
    const unsubscribe = installAutoExport(db, 41321);

    persistSyncOutcome(db, "fanza_doujin", {
      ok: false,
      error: "synthetic",
      counts: { inserted: 0, updated: 0 },
    });
    assert.ok(!existsSync(snapshotPath(dest)));

    unsubscribe();
    db.close();
  });

  it("skips export when no destination is configured", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(tmpdir(), "adp-export-nodest-"));
    persistAdminSettings(db, { port: 41321, exportDestination: "" }, new Date().toISOString());
    const unsubscribe = installAutoExport(db, 41321);

    persistSyncOutcome(db, "fanza_doujin", {
      ok: true,
      counts: { inserted: 1, updated: 0 },
    });
    assert.ok(!existsSync(snapshotPath(dest)));

    unsubscribe();
    db.close();
  });
});

describe("exportSnapshot service", () => {
  it("writes directly (service seam, quote escaping round-trip)", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(tmpdir(), "adp-export-svc-")) + "/a'b";
    const result = exportSnapshot(db, dest);
    assert.equal(result.path, join(dest, EXPORT_FILENAME));
    assert.equal(countListings(result.path), 2);
    assert.deepEqual(tempResidue(dest), []);
    db.close();
  });

  it("cleans temp and preserves existing target when VACUUM fails", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(tmpdir(), "adp-export-vacfail-"));
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
    const dest = mkdtempSync(join(tmpdir(), "adp-export-renamefail-"));
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
    const dest = mkdtempSync(join(tmpdir(), "adp-export-midfail-"));
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

  it("refuses a destination directory that is a symlink (no write-outside)", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const root = mkdtempSync(join(tmpdir(), "adp-export-symlink-dest-"));
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
    const dest = mkdtempSync(join(tmpdir(), "adp-export-symlink-tgt-"));
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

  it("does not use a fixed predictable .tmp name that can be raced", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(tmpdir(), "adp-export-notmp-"));
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
    const dest = mkdtempSync(join(tmpdir(), "adp-export-exclusive-"));
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
});

describe("production startServer auto-export lifecycle", () => {
  after(() => {
    clearSyncSuccessListeners();
  });

  it("unsubscribes on close so later syncs do not export or touch a closed DB", async () => {
    const dir = mkdtempSync(join(tmpdir(), "adp-export-lifecycle-"));
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
      const outcome = await request(started.port, "POST", "/api/sync-outcome/fanza_doujin", {
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
      persistSyncOutcome(post.sqlite, "fanza_doujin", {
        ok: true,
        counts: { inserted: 0, updated: 1 },
        fetched: 1,
      });
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
    const dir = mkdtempSync(join(tmpdir(), "adp-export-dblclose-"));
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

  it("cleans up after listen failure (port already bound)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "adp-export-listenfail-"));
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

    const started = startServer({
      env: { ADP_DB_PATH: dbPath },
      host: "127.0.0.1",
      port: busyPort,
      listen: true,
      fetchImpl: (async () => new Response(null, { status: 404 })) as typeof fetch,
    });

    await assert.rejects(() => started.ready);
    assert.doesNotThrow(() => {
      started.close();
      started.close();
    });
    blocker.close();
    clearSyncSuccessListeners();
    rmSync(dir, { recursive: true, force: true });
  });

  it("multiple startServer instances each export independently and close cleanly", async () => {
    const dir = mkdtempSync(join(tmpdir(), "adp-export-multi-"));
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

      const ra = await request(a.port, "POST", "/api/sync-outcome/fanza_doujin", {
        ok: true,
        counts: { inserted: 1, updated: 0 },
      });
      const rb = await request(b.port, "POST", "/api/sync-outcome/fanza_doujin", {
        ok: true,
        counts: { inserted: 1, updated: 0 },
      });
      assert.equal(ra.status, 200);
      assert.equal(rb.status, 200);
      assert.ok(existsSync(snapshotPath(destA)));
      assert.ok(existsSync(snapshotPath(destB)));

      a.close();
      b.close();

      rmSync(snapshotPath(destA), { force: true });
      rmSync(snapshotPath(destB), { force: true });

      const postA = openDatabase(dbPathA);
      persistSyncOutcome(postA.sqlite, "fanza_doujin", {
        ok: true,
        counts: { inserted: 0, updated: 1 },
      });
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
});
