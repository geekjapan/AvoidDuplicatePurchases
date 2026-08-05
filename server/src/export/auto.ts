import type { DatabaseSync } from "node:sqlite";
import {
  subscribeSyncSuccess,
  type SyncSuccessPayload,
} from "../hooks/sync-success.js";
import { getLatestSyncOutcome } from "../import/fanza/common.js";
import { loadAdminSettings } from "../routes/settings.js";
import { exportSnapshot, type ExportResult } from "./export.js";

/** Canonical auto-export trigger (spec §9: after successful full sync only). */
const AUTO_EXPORT_SOURCE = "full_sync";

type ExportSnapshotFn = (
  db: DatabaseSync,
  destination: string,
) => ExportResult;

interface InstallAutoExportOptions {
  /**
   * Test seam to instrument export call counts.
   * Production leaves this unset.
   */
  exportSnapshot?: ExportSnapshotFn;
}

/**
 * Decide whether this module-global sync-success event should trigger export
 * for the given DB instance.
 *
 * Isolation rules (scope-safe; hooks/http stay read-only):
 * - Only `source === "full_sync"` with ok outcome.
 * - The same outcome must already be persisted on *this* DB (recordedAt +
 *   counts/fetched match) so another startServer instance's event cannot
 *   cross-fire into this export.
 * - One successful export per distinct full_sync recordedAt (dedupe).
 */
function shouldAutoExportForDb(
  db: DatabaseSync,
  payload: SyncSuccessPayload,
  lastExportedRecordedAt: string | null,
): { export: true; recordedAt: string } | { export: false } {
  if (payload.source !== AUTO_EXPORT_SOURCE) {
    return { export: false };
  }
  if (!payload.outcome.ok) {
    return { export: false };
  }

  const recordedAt = payload.outcome.recordedAt;
  if (!recordedAt) {
    return { export: false };
  }
  if (lastExportedRecordedAt === recordedAt) {
    return { export: false };
  }

  const latest = getLatestSyncOutcome(db, AUTO_EXPORT_SOURCE);
  if (!latest || !latest.ok) {
    return { export: false };
  }
  if (latest.recordedAt !== recordedAt) {
    return { export: false };
  }
  if (
    latest.counts.inserted !== payload.outcome.counts.inserted ||
    latest.counts.updated !== payload.outcome.counts.updated ||
    latest.fetched !== payload.outcome.fetched
  ) {
    return { export: false };
  }

  return { export: true, recordedAt };
}

/**
 * Auto-export after a successful full sync (spec §9).
 * Silent no-op when no destination is configured. Listener failures are
 * swallowed by the sync-success hook, so a failed export never breaks sync
 * persistence.
 *
 * Partial source outcomes (dlsite / fanza_*) never export. Only the
 * canonical `full_sync` success path does, at most once per recordedAt,
 * and only when this DB is the originator of the persisted outcome.
 */
export function installAutoExport(
  db: DatabaseSync,
  port: number,
  options: InstallAutoExportOptions = {},
): () => void {
  const runExport = options.exportSnapshot ?? exportSnapshot;
  // An already-persisted outcome predates this listener. Seeding the dedupe
  // fence prevents a matching event from another server instance from
  // exporting this DB's stale outcome after restart.
  let lastExportedRecordedAt =
    getLatestSyncOutcome(db, AUTO_EXPORT_SOURCE)?.recordedAt ?? null;

  return subscribeSyncSuccess((payload) => {
    const decision = shouldAutoExportForDb(db, payload, lastExportedRecordedAt);
    if (!decision.export) return;

    const destination = loadAdminSettings(db, port).exportDestination.trim();
    if (!destination) return;

    runExport(db, destination);
    lastExportedRecordedAt = decision.recordedAt;
  });
}
