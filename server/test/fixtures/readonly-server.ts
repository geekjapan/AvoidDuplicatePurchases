/**
 * Thin production-entry launcher for read-only / normal secondary-process tests.
 *
 * Does NOT reimplement production wiring: it spawns the same `startServer` from
 * `server/src/static.ts` (the production entry SHA under test) and prints
 * `READY <port>` once listening. SIGTERM/SIGINT close the instance cleanly.
 */
import { startServer } from "../../src/static.js";

const env = process.env as Record<string, string | undefined>;
const dbPath = env.ADP_DB_PATH ?? "";

if (!dbPath) {
  console.error("production-entry fixture requires ADP_DB_PATH");
  process.exit(2);
}

const started = startServer({
  env,
  host: "127.0.0.1",
  port: 0,
  listen: true,
});

const shutdown = (): void => {
  try {
    started.close();
  } catch {
    // ignore double-close during signal races
  }
  process.exit(0);
};

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

started.ready
  .then(() => {
    console.log(`READY ${started.port}`);
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    try {
      started.close();
    } catch {
      // ignore
    }
    process.exit(1);
  });
