import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { type DatabaseSync } from "node:sqlite";
import { openDatabase } from "../src/db.js";
import { handleApi } from "../src/http.js";
import { withReadonlyGuard } from "../src/middleware/readonly-guard.js";
import { isReadonlyMode, openReadonlyDatabase } from "../src/config/readonly.js";
import { exportSnapshot } from "../src/export/export.js";
import "../src/routes/settings.js";
import "../src/routes/listings.js";
import "../src/routes/candidates.js";
import "../src/routes/manual.js";
import "../src/export/route.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "fixtures", "readonly-server.ts");
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

describe("readonly config", () => {
  it("reads the ADP_READONLY flag", () => {
    assert.equal(isReadonlyMode({ ADP_READONLY: "1" }), true);
    assert.equal(isReadonlyMode({}), false);
    assert.equal(isReadonlyMode({ ADP_READONLY: "0" }), false);
  });

  it("opens a snapshot DB read-only without migrations", () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(tmpdir(), "adp-ro-config-"));
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

  it("does not touch non-API paths", async () => {
    const res = await request(port, "GET", "/static/asset.js");
    assert.equal(res.status, 404);
  });
});

describe("read-only secondary process", () => {
  let child: ChildProcess;
  let port: number;
  let snapshot: string;
  let beforeHash: string;

  before(async () => {
    const db = openDatabase(":memory:").sqlite;
    seedListings(db);
    const dest = mkdtempSync(join(tmpdir(), "adp-ro-process-"));
    snapshot = exportSnapshot(db, dest).path;
    db.close();
    beforeHash = sha256(snapshot);

    port = await new Promise<number>((resolve, reject) => {
      const proc = spawn(process.execPath, ["--import", "tsx", FIXTURE], {
        cwd: join(__dirname, ".."),
        env: { ...process.env, ADP_READONLY: "1", ADP_DB_PATH: snapshot },
        stdio: ["ignore", "pipe", "pipe"],
      });
      child = proc;
      let output = "";
      let settled = false;
      proc.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        const match = output.match(/READY (\d+)/);
        if (match && !settled) {
          settled = true;
          resolve(Number(match[1]));
        }
      });
      proc.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString();
      });
      proc.on("error", reject);
      proc.on("exit", (code) => {
        if (!settled) {
          settled = true;
          reject(new Error(`readonly fixture exited early (${code}): ${output}`));
        }
      });
    });
  });

  after(() => {
    if (child && child.exitCode === null) child.kill();
  });

  it("serves lookup and rejects every write route over HTTP", async () => {
    const lookup = await request(port, "POST", "/api/lookup", {
      items: [{ source: "dlsite", cid: "RJ000001" }],
    }, null);
    assert.equal(lookup.status, 200);

    for (const [method, path, body] of WRITE_ROUTES) {
      const res = await request(port, method, path, body, null);
      assert.equal(res.status, 403, `${method} ${path} must be 403`);
    }

    const listings = await request(port, "GET", "/api/listings", undefined, null);
    assert.equal(listings.status, 200);
  });

  it("leaves the snapshot DB byte-identical", () => {
    assert.equal(sha256(snapshot), beforeHash);
  });
});
