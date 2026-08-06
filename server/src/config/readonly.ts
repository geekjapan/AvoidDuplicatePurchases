import { DatabaseSync } from "node:sqlite";

/**
 * Read-only mode flag (spec §9 secondary machine).
 * `ADP_READONLY=1` makes the server open the snapshot DB directly and reject
 * every API write route with 403 via the readonly guard.
 */
export function isReadonlyMode(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.ADP_READONLY === "1";
}

/**
 * Open a snapshot DB strictly read-only: no migrations, no writes.
 * Fails fast when the file is missing (a read-only machine has nothing to read).
 */
export function openReadonlyDatabase(path: string): DatabaseSync {
  return new DatabaseSync(path, { readOnly: true });
}
