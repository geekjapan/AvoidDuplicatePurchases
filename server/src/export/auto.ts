import type { DatabaseSync } from "node:sqlite";
import { subscribeSyncSuccess } from "../hooks/sync-success.js";
import { loadAdminSettings } from "../routes/settings.js";
import { exportSnapshot } from "./export.js";

/**
 * Auto-export after every successful sync (spec §9).
 * Silent no-op when no destination is configured. Listener failures are
 * swallowed by the sync-success hook, so a failed export never breaks sync
 * persistence.
 */
export function installAutoExport(db: DatabaseSync, port: number): () => void {
  return subscribeSyncSuccess(() => {
    const destination = loadAdminSettings(db, port).exportDestination.trim();
    if (!destination) return;
    exportSnapshot(db, destination);
  });
}
