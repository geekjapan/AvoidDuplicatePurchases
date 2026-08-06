import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { type DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/db.js";
import { handleApi } from "../src/http.js";
import { withReadonlyGuard } from "../src/middleware/readonly-guard.js";
import { isReadonlyMode, openReadonlyDatabase } from "../src/config/readonly.js";
import { exportSnapshot } from "../src/export/export.js";
import { handleStatic, startServer } from "../src/static.js";
import { clearSyncSuccessListeners } from "../src/hooks/sync-success.js";
import { persistAdminSettings } from "../src/routes/settings.js";
import { persistSyncOutcome } from "../src/import/fanza/common.js";
import "../src/routes/settings.js";
import "../src/routes/listings.js";
import "../src/routes/candidates.js";
import "../src/routes/manual.js";
import "../src/export/route.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Thin launcher that imports production startServer from static.ts (same SHA). */
const PRODUCTION_ENTRY_FIXTURE = join(__dirname, "fixtures", "readonly-server.ts");
const TEST_EXTENSION_ORIGIN = "chrome-extension://test-extension";
const TEST_EXTENSION_ORIGINS = new Set([TEST_EXTENSION_ORIGIN]);

/** realpath'd tmp base so export symlink-ancestor checks accept macOS temp paths. */
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
            let json: unknown = null;
            if (text.length) {
              try {
                json = JSON.parse(text);
              } catch {
                json = text;
              }
            }
            resolve({ status: res.statusCode ?? 0, json });
          });
        },
      );
      r.on("error", reject);
      if (payload !== undefined) r.write(payload);
      r.end();
    });
  });
}

function seedListings(db: DatabaseSync): void {
  db.exec("INSERT INTO work (id) VALUES (1), (2)");
  db.exec(
    `INSERT INTO listing (id, source, cid, work_id, title, raw_json, imported_at) VALUES
       (1, 'dlsite', 'RJ000001', 1, 'alpha', '{}', '2026-01-01T00:00:00.000Z'),
       (2, 'fanza_doujin', 'd_123456', 2, 'beta', '{}', '2026-01-01T00:00:00.000Z')`,
  );
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function dirFingerprint(dir: string): string {
  const names = readdirSync(dir).sort();
  const parts: string[] = [];
  for (const name of names) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isFile()) {
      parts.push(`${name}:${st.size}:${sha256(p)}`);
    } else {
      parts.push(`${name}:dir`);
    }
  }
  return parts.join("|");
}

/** Write routes that must all answer 403 in read-only mode (acceptance 3/7). */
const WRITE_ROUTES: Array<[string, string, unknown]> = [
  ["POST", "/api/import/dlsite", { items: [{ cid: "RJ000001" }] }],
  ["POST", "/api/import/fanza_doujin", { items: [{ cid: "d_123456" }] }],
  ["POST", "/api/sync-state/dlsite", { cursor: "last=1" }],
  ["POST", "/api/sync-outcome/fanza_doujin", { ok: true, counts: { inserted: 1, updated: 0 } }],
  ["POST", "/api/rematch", {}],
  ["POST", "/api/candidates/1", { same: true }],
  ["POST", "/api/listings/manual", { url: "https://www.dlsite.com/maniax/work/=/product_id/RJ000001.html" }],
  ["POST", "/api/listings/dlsite/RJ000001/work", { workId: 1 }],
  ["POST", "/api/settings", { port: 41321, exportDestination: "/tmp/adp-export" }],
  ["POST", "/api/export", { destination: "/tmp/adp-export" }],
];

const UNKNOWN_WRITE_METHODS: Array<[string, string]> = [
  ["PUT", "/api/listings"],
  ["PATCH", "/api/settings"],
  ["DELETE", "/api/listings/1"],
  ["POST", "/api/does-not-exist"],
];

async function spawnProductionEntry(env: Record<string, string>): Promise<{
  child: ChildProcess;
  port: number;
}> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ["--import", "tsx", PRODUCTION_ENTRY_FIXTURE], {
      cwd: join(__dirname, ".."),
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let settled = false;
    proc.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/READY (\d+)/);
      if (match && !settled) {
        settled = true;
        resolve({ child: proc, port: Number(match[1]) });
      }
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`production entry exited early (${code}): ${output}`));
      }
    });
  });
}

describe("readonly config", () => {
  it("reads the ADP_READONLY flag", () => {
    assert.equal(isReadonlyMode({ ADP_READONLY: "1" }), true);
    assert.equal(isReadonlyMode({}), false);
    assert.equal(isReadonlyMode({ ADP_READONLY: "0" }), false);
  });

  it("opens a snapshot DB read-only without migrations", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(realTmp(), "adp-ro-config-"));
    const snapshot = exportSnapshot(db, dest).path;
    db.close();

    const ro = openReadonlyDatabase(snapshot);
    const count = (ro.prepare("SELECT COUNT(*) AS c FROM listing").get() as { c: number }).c;
    assert.equal(count, 2);
    assert.throws(() => ro.exec("DELETE FROM listing"), /readonly/);
    ro.close();
  });
});

describe("readonly guard", () => {
  let server: Server;
  let port: number;
  let db: DatabaseSync;

  before(async () => {
    db = openDatabase(":memory:").sqlite;
    seedListings(db);
    await new Promise<void>((resolve, reject) => {
      let listenPort = 41321;
      server = createServer(async (req, res) => {
        const handled = await withReadonlyGuard(handleApi)(req, res, {
          db,
          port: listenPort,
          extensionOrigins: TEST_EXTENSION_ORIGINS,
        });
        if (!handled) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "not_found" }));
        }
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        listenPort = typeof addr === "object" && addr ? addr.port : listenPort;
        port = listenPort;
        resolve();
      });
      server.on("error", reject);
    });
  });

  after(() => {
    server.close();
    db.close();
  });

  for (const [method, path, body] of WRITE_ROUTES) {
    it(`rejects ${method} ${path} with 403`, async () => {
      const res = await request(port, method, path, body);
      assert.equal(res.status, 403);
      assert.deepEqual(res.json, { error: "forbidden" });
    });
  }

  it("permits POST /api/lookup", async () => {
    const res = await request(port, "POST", "/api/lookup", {
      items: [{ source: "dlsite", cid: "RJ000001" }],
    });
    assert.equal(res.status, 200);
    const json = res.json as { results: Array<{ owned: boolean }> };
    assert.equal(json.results.length, 1);
    assert.equal(json.results[0].owned, true);
  });

  it("permits GET read routes", async () => {
    const listings = await request(port, "GET", "/api/listings");
    assert.equal(listings.status, 200);
    const candidates = await request(port, "GET", "/api/candidates");
    assert.equal(candidates.status, 200);
    const syncState = await request(port, "GET", "/api/sync-state/dlsite");
    assert.equal(syncState.status, 200);
    const settings = await request(port, "GET", "/api/settings");
    assert.equal(settings.status, 200);
  });

  it("rejects unknown GET /api routes with 403 (not 404)", async () => {
    for (const path of [
      "/api/does-not-exist",
      "/api/listings/extra",
      "/api/sync-state/unknown_source",
      "/api/export",
    ]) {
      const res = await request(port, "GET", path);
      assert.equal(res.status, 403, `${path} must be 403`);
      assert.deepEqual(res.json, { error: "forbidden" });
    }
  });

  it("rejects exact GET /api and encoded separator variants with 403", async () => {
    for (const path of ["/api", "/api/", "/api%2F", "/api%2f"]) {
      const res = await request(port, "GET", path);
      assert.equal(res.status, 403, `GET ${path} must be 403`);
      assert.deepEqual(res.json, { error: "forbidden" });
    }
  });

  it("does not touch non-API paths", async () => {
    const res = await request(port, "GET", "/static/asset.js");
    assert.equal(res.status, 404);
  });
});

describe("handleStatic API namespace gate (direct handler)", () => {
  it("does not serve SPA for /api root and encoded separator variants", () => {
    for (const path of ["/api", "/api/", "/api%2F", "/api%2f"]) {
      const url = new URL(path, "http://127.0.0.1:1");
      let status: number | null = null;
      let ended = false;
      const res = {
        writeHead(code: number) {
          status = code;
          return res;
        },
        end() {
          ended = true;
          return res;
        },
      } as unknown as import("node:http").ServerResponse;
      const req = {} as import("node:http").IncomingMessage;
      const handled = handleStatic(req, res, url);
      assert.equal(
        handled,
        false,
        `${path}: handleStatic must not claim SPA for API namespace`,
      );
      assert.equal(status, null, `${path}: must not write SPA status`);
      assert.equal(ended, false, `${path}: must not end SPA body`);
    }
  });
});

describe("production startServer read-only mode (in-process, same static.ts)", () => {
  after(() => {
    clearSyncSuccessListeners();
  });

  it("enforces readonly HTTP contract without writing snapshot bytes", async () => {
    const root = mkdtempSync(join(realTmp(), "adp-ro-static-"));
    const dest = mkdtempSync(join(root, "snap-"));
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const snapshot = exportSnapshot(db, dest).path;
    db.close();

    const beforeHash = sha256(snapshot);
    const beforeDir = dirFingerprint(dest);
    // Sidecar markers that must stay absent/unchanged.
    const wal = `${snapshot}-wal`;
    const shm = `${snapshot}-shm`;
    assert.ok(!existsSync(wal));
    assert.ok(!existsSync(shm));

    const started = startServer({
      env: {
        ADP_READONLY: "1",
        ADP_DB_PATH: snapshot,
        ADP_EXTENSION_ORIGIN: TEST_EXTENSION_ORIGIN,
      },
      host: "127.0.0.1",
      port: 0,
      listen: true,
      fetchImpl: (async () => new Response(null, { status: 404 })) as typeof fetch,
    });

    try {
      await started.ready;

      const lookup = await request(started.port, "POST", "/api/lookup", {
        items: [{ source: "dlsite", cid: "RJ000001" }],
      });
      assert.equal(lookup.status, 200);

      const listings = await request(started.port, "GET", "/api/listings");
      assert.equal(listings.status, 200);

      for (const [method, path, body] of WRITE_ROUTES) {
        const res = await request(started.port, method, path, body);
        assert.equal(res.status, 403, `${method} ${path}`);
        assert.deepEqual(res.json, { error: "forbidden" });
      }

      for (const [method, path] of UNKNOWN_WRITE_METHODS) {
        const res = await request(started.port, method, path, {});
        assert.equal(res.status, 403, `${method} ${path}`);
      }

      for (const path of ["/api/does-not-exist", "/api/listings/extra", "/api/export"]) {
        const res = await request(started.port, "GET", path);
        assert.equal(res.status, 403, `GET ${path}`);
        assert.deepEqual(res.json, { error: "forbidden" });
      }

      // Exact /api must not fall through to SPA index.html (200 HTML).
      for (const path of ["/api", "/api/", "/api%2F", "/api%2f"]) {
        const res = await request(started.port, "GET", path);
        assert.equal(res.status, 403, `GET ${path} must be 403 (not SPA)`);
        assert.deepEqual(res.json, { error: "forbidden" });
      }

      const badOrigin = await request(
        started.port,
        "GET",
        "/api/listings",
        undefined,
        "https://evil.example",
      );
      assert.equal(badOrigin.status, 403);

      assert.equal(sha256(snapshot), beforeHash);
      assert.equal(dirFingerprint(dest), beforeDir);
      assert.ok(!existsSync(wal));
      assert.ok(!existsSync(shm));
    } finally {
      started.close();
      clearSyncSuccessListeners();
    }
  });

  it("does not mkdir or mutate DB path on readonly startup", async () => {
    const root = mkdtempSync(join(realTmp(), "adp-ro-startup-"));
    const dest = mkdtempSync(join(root, "snap-"));
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const snapshot = exportSnapshot(db, dest).path;
    db.close();

    const missingSibling = join(root, "never-created", "data.sqlite");
    const beforeRoot = dirFingerprint(root);

    // Missing DB must fail fast without creating parent directories for writes.
    assert.throws(() =>
      startServer({
        env: {
          ADP_READONLY: "1",
          ADP_DB_PATH: missingSibling,
        },
        host: "127.0.0.1",
        port: 0,
        listen: false,
      }),
    );
    assert.ok(!existsSync(join(root, "never-created")));
    assert.equal(dirFingerprint(root), beforeRoot);

    const beforeHash = sha256(snapshot);
    const started = startServer({
      env: {
        ADP_READONLY: "1",
        ADP_DB_PATH: snapshot,
      },
      host: "127.0.0.1",
      port: 0,
      listen: false,
    });
    try {
      await started.ready;
      assert.equal(sha256(snapshot), beforeHash);
    } finally {
      started.close();
      clearSyncSuccessListeners();
    }
  });
});

describe("production startServer normal mode auto-export + close", () => {
  after(() => {
    clearSyncSuccessListeners();
  });

  it("auto-exports on success sync and detaches listener on close", async () => {
    const root = mkdtempSync(join(realTmp(), "adp-normal-auto-"));
    const dbPath = join(root, "data.sqlite");
    const dest = mkdtempSync(join(root, "sync-"));

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
      const ok = await request(started.port, "POST", "/api/sync-outcome/full_sync", {
        ok: true,
        counts: { inserted: 1, updated: 0 },
      });
      assert.equal(ok.status, 200);
      assert.ok(existsSync(join(dest, "adp-export.sqlite")));

      started.close();
      // Post-close direct sync must not recreate export (listener unsubscribed).
      writeFileSync(join(dest, "marker"), "1");
      const listingBefore = readdirSync(dest).sort().join(",");
      const post = openDatabase(dbPath);
      persistSyncOutcome(post.sqlite, "full_sync", {
        ok: true,
        counts: { inserted: 0, updated: 1 },
      });
      post.close();
      assert.equal(readdirSync(dest).sort().join(","), listingBefore);
    } finally {
      try {
        started.close();
      } catch {
        // ignore
      }
      clearSyncSuccessListeners();
    }
  });
});

describe("production-entry child process (thin launcher → static.startServer)", () => {
  let child: ChildProcess;
  let port: number;
  let snapshot: string;
  let beforeHash: string;
  let dest: string;
  let beforeDir: string;

  before(async () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    dest = mkdtempSync(join(realTmp(), "adp-ro-process-"));
    snapshot = exportSnapshot(db, dest).path;
    db.close();
    beforeHash = sha256(snapshot);
    beforeDir = dirFingerprint(dest);

    const spawned = await spawnProductionEntry({
      ADP_READONLY: "1",
      ADP_DB_PATH: snapshot,
      ADP_EXTENSION_ORIGIN: TEST_EXTENSION_ORIGIN,
    });
    child = spawned.child;
    port = spawned.port;
  });

  after(() => {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
    }
    clearSyncSuccessListeners();
  });

  it("serves lookup/read, rejects writes/unknown methods/bad Origin, leaves DB bytes intact", async () => {
    const lookup = await request(
      port,
      "POST",
      "/api/lookup",
      { items: [{ source: "dlsite", cid: "RJ000001" }] },
      null,
    );
    assert.equal(lookup.status, 200);

    const listings = await request(port, "GET", "/api/listings", undefined, null);
    assert.equal(listings.status, 200);

    for (const [method, path, body] of WRITE_ROUTES) {
      const res = await request(port, method, path, body, null);
      assert.equal(res.status, 403, `${method} ${path} must be 403`);
    }

    for (const [method, path] of UNKNOWN_WRITE_METHODS) {
      const res = await request(port, method, path, {}, null);
      assert.equal(res.status, 403, `${method} ${path} must be 403`);
    }

    for (const path of ["/api/does-not-exist", "/api/listings/extra", "/api/export"]) {
      const res = await request(port, "GET", path, undefined, null);
      assert.equal(res.status, 403, `GET ${path} must be 403`);
      assert.deepEqual(res.json, { error: "forbidden" });
    }

    for (const path of ["/api", "/api/", "/api%2F", "/api%2f"]) {
      const res = await request(port, "GET", path, undefined, null);
      assert.equal(res.status, 403, `GET ${path} must be 403 (not SPA)`);
      assert.deepEqual(res.json, { error: "forbidden" });
    }

    const badOrigin = await request(
      port,
      "GET",
      "/api/listings",
      undefined,
      "https://evil.example",
    );
    assert.equal(badOrigin.status, 403);

    assert.equal(sha256(snapshot), beforeHash);
    assert.equal(dirFingerprint(dest), beforeDir);
  });
});
