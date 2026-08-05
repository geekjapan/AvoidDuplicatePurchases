/**
 * Test-only read-only server process (T-EXPORT acceptance 3/4).
 * Mirrors the intended production wiring: ADP_READONLY=1 opens the snapshot
 * DB directly (no migrations, read-only handle) and wraps the API with the
 * readonly guard. Prints `READY <port>` once listening.
 */
import { createServer } from "node:http";
import { isReadonlyMode, openReadonlyDatabase } from "../../src/config/readonly.js";
import { handleApi } from "../../src/http.js";
import { withReadonlyGuard } from "../../src/middleware/readonly-guard.js";
import "../../src/routes/listings.js";
import "../../src/routes/candidates.js";
import "../../src/routes/work.js";
import "../../src/routes/settings.js";
import "../../src/routes/manual.js";
import "../../src/export/route.js";

const env = process.env as Record<string, string | undefined>;
const dbPath = env.ADP_DB_PATH ?? "";

if (!isReadonlyMode(env) || !dbPath) {
  console.error("readonly-server fixture requires ADP_READONLY=1 and ADP_DB_PATH");
  process.exit(2);
}

const db = openReadonlyDatabase(dbPath);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1:0");
    const handled = await withReadonlyGuard(handleApi)(req, res, {
      db,
      port: 0,
      extensionOrigins: new Set(),
    });
    if (handled) return;
    if (url.pathname.startsWith("/api/")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    res.writeHead(404);
    res.end();
  } catch {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "internal_error" }));
  }
});

server.listen(0, "127.0.0.1", () => {
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  console.log(`READY ${port}`);
});
