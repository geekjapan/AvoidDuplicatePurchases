import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, it } from "node:test";
import { clearSyncSuccessListeners } from "../src/hooks/sync-success.js";
import { startServer } from "../src/static.js";

function request(port: number, runtimeId?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path: "/__adp/runtime",
        headers: {
          Origin: `http://127.0.0.1:${port}`,
          ...(runtimeId ? { "X-ADP-Runtime-Id": runtimeId } : {}),
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

after(() => clearSyncSuccessListeners());

it("acknowledges only the configured runtime identity", async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), "adp-runtime-identity-")), "data.sqlite");
  const runtimeId = "b".repeat(64);
  const started = startServer({
    env: { ADP_DB_PATH: dbPath, ADP_RUNTIME_ID: runtimeId },
    host: "127.0.0.1",
    port: 0,
    fetchImpl: (async () => new Response(null, { status: 404 })) as typeof fetch,
  });

  try {
    await started.ready;
    assert.equal(await request(started.port, runtimeId), 204);
    assert.equal(await request(started.port, "c".repeat(64)), 404);
    assert.equal(await request(started.port), 404);
  } finally {
    started.close();
  }
});
