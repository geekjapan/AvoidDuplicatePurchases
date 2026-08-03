import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { openDatabase } from "../src/db.js";
import { handleApi } from "../src/http.js";
import type { DatabaseSync } from "node:sqlite";

const __dirname = dirname(fileURLToPath(import.meta.url));

function request(
  port: number,
  path: string,
  origin?: string,
): Promise<{ status: number; text: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    import("node:http").then(({ request: httpRequest }) => {
      const r = httpRequest(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method: "GET",
          headers: origin ? { Origin: origin } : {},
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            resolve({
              status: res.statusCode ?? 0,
              text: Buffer.concat(chunks).toString("utf8"),
              headers: res.headers,
            });
          });
        },
      );
      r.on("error", reject);
      r.end();
    });
  });
}

describe("origin protection", () => {
  let server: Server;
  let port: number;
  let db: DatabaseSync;

  before(async () => {
    const dbPath = join(__dirname, `origin-db-${Date.now()}.sqlite`);
    const appDb = openDatabase(dbPath);
    db = appDb.sqlite;
    let listenPort = 0;
    server = createServer(async (req, res) => {
      await handleApi(req, res, { db, port: listenPort });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        listenPort = typeof addr === "object" && addr ? addr.port : 0;
        port = listenPort;
        resolve();
      });
    });
  });

  after(() => {
    server.close();
    db.close();
  });

  it("allows chrome-extension origin", async () => {
    const res = await request(
      port,
      "/api/sync-state/dlsite",
      "chrome-extension://abcdefghijklmnop",
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers["access-control-allow-origin"], undefined);
  });

  it("allows same-origin admin requests", async () => {
    const res = await request(port, "/api/sync-state/dlsite", `http://127.0.0.1:${port}`);
    assert.equal(res.status, 200);
  });

  it("rejects disallowed browser origins without leaking internal paths", async () => {
    const res = await request(port, "/api/sync-state/dlsite", "https://evil.example.com");
    assert.equal(res.status, 403);
    assert.match(res.text, /forbidden/);
    assert.doesNotMatch(res.text, /\/Users\/|ENOENT|stack/i);
    assert.equal(res.headers["access-control-allow-origin"], undefined);
  });

  it("allows requests with no Origin header", async () => {
    const res = await request(port, "/api/sync-state/dlsite");
    assert.equal(res.status, 200);
  });
});
