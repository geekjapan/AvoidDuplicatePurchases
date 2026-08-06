import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { openDatabase } from "../src/db.js";
import { handleApi } from "../src/http.js";
import type { DatabaseSync } from "node:sqlite";
import "../src/routes/settings.js";

const TEST_EXTENSION_ORIGIN = "chrome-extension://test-extension";
const TEST_EXTENSION_ORIGINS = new Set([TEST_EXTENSION_ORIGIN]);

function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown; text: string }> {
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
            resolve({
              status: res.statusCode ?? 0,
              json: text.length ? JSON.parse(text) : null,
              text,
            });
          });
        },
      );
      r.on("error", reject);
      if (payload !== undefined) r.write(payload);
      r.end();
    });
  });
}

function startTestServer(db: DatabaseSync): Promise<{ server: Server; port: number }> {
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

describe("settings API", () => {
  let server: Server;
  let port: number;
  let db: DatabaseSync;

  before(async () => {
    db = openDatabase(":memory:").sqlite;
    ({ server, port } = await startTestServer(db));
  });

  after(() => {
    server.close();
    db.close();
  });

  it("returns runtime port default when nothing persisted", async () => {
    const res = await request(port, "GET", "/api/settings");
    assert.equal(res.status, 200);
    const body = res.json as { port: number; exportDestination: string };
    assert.equal(body.port, port);
    assert.equal(body.exportDestination, "");
  });

  it("atomically persists port and absolute exportDestination", async () => {
    const destination = "/tmp/adp-export-folder";
    const saved = await request(port, "POST", "/api/settings", {
      port: 43210,
      exportDestination: destination,
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.json, { port: 43210, exportDestination: destination });

    const row = db
      .prepare("SELECT cursor FROM sync_state WHERE source = ?")
      .get("__admin_settings__") as { cursor: string } | undefined;
    assert.ok(row);
    assert.match(row.cursor, /43210/);
    assert.match(row.cursor, /adp-export-folder/);

    const loaded = await request(port, "GET", "/api/settings");
    assert.equal(loaded.status, 200);
    assert.deepEqual(loaded.json, { port: 43210, exportDestination: destination });
  });

  it("rejects invalid port and relative export paths", async () => {
    const badPort = await request(port, "POST", "/api/settings", {
      port: 70000,
      exportDestination: "/abs/ok",
    });
    assert.equal(badPort.status, 400);

    const relative = await request(port, "POST", "/api/settings", {
      port: 41321,
      exportDestination: "relative/path",
    });
    assert.equal(relative.status, 400);
  });
});

describe("persisted settings survive reopen (restart-equivalent)", () => {
  it("loadAdminSettings returns saved port/exportDestination after DB reopen", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { loadAdminSettings, persistAdminSettings } = await import("../src/routes/settings.js");
    const dir = mkdtempSync(join(tmpdir(), "adp-settings-"));
    const dbPath = join(dir, "data.sqlite");
    try {
      const first = openDatabase(dbPath);
      persistAdminSettings(
        first.sqlite,
        { port: 43210, exportDestination: "/tmp/adp-export-folder" },
        new Date().toISOString(),
      );
      first.close();

      const second = openDatabase(dbPath);
      const settings = loadAdminSettings(second.sqlite, 41321);
      assert.deepEqual(settings, {
        port: 43210,
        exportDestination: "/tmp/adp-export-folder",
      });
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
