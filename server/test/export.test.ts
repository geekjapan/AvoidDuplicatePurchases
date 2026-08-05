import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync } from "node:fs";
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

const TEST_EXTENSION_ORIGIN = "chrome-extension://test-extension";
const TEST_EXTENSION_ORIGINS = new Set([TEST_EXTENSION_ORIGIN]);

function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
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
            Origin: TEST_EXTENSION_ORIGIN,
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
  });

  it("overwrites the previous snapshot on a second export", async () => {
    const first = await request(port, "POST", "/api/export", { destination: dest });
    assert.equal(first.status, 200);
    const second = await request(port, "POST", "/api/export", { destination: dest });
    assert.equal(second.status, 200);
    assert.equal(countListings(snapshotPath(dest)), 2);
  });

  it("escapes quotes in the destination path", async () => {
    const quoted = mkdtempSync(join(tmpdir(), "adp-export-quote-")) + "/o'quote";
    persistAdminSettings(db, { port: 41321, exportDestination: quoted }, new Date().toISOString());
    const res = await request(port, "POST", "/api/export", { destination: quoted });
    assert.equal(res.status, 200);
    assert.ok(existsSync(snapshotPath(quoted)));
    assert.equal(countListings(snapshotPath(quoted)), 2);
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
    db.close();
  });
});
