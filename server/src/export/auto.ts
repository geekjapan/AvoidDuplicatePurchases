import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  subscribeSyncSuccess,
  type SyncSuccessPayload,
} from "../hooks/sync-success.js";
import {
  bindOriginInstanceId,
  getLatestSyncOutcomeRecord,
} from "../import/fanza/common.js";
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
  /**
   * Optional fixed origin id (tests). Production generates a UUID per install.
   */
  originInstanceId?: string;
}

/**
 * Decide whether this module-global sync-success event should trigger export
 * for the given DB instance.
 *
 * Isolation / exactly-once rules:
 * - Only `source === "full_sync"` with ok outcome.
 * - Payload must carry syncId + originInstanceId.
 * - This install's originInstanceId must match the payload (origin proof).
 * - The same outcome must already be persisted on *this* DB with matching
 *   syncId + originInstanceId + counts/fetched (cross-instance events fail).
 * - One successful export per distinct syncId (not recordedAt).
 */
function shouldAutoExportForDb(
  db: DatabaseSync,
  payload: SyncSuccessPayload,
  originInstanceId: string,
  lastExportedSyncId: string | null,
): { export: true; syncId: string } | { export: false } {
  if (payload.source !== AUTO_EXPORT_SOURCE) {
    return { export: false };
  }
  if (!payload.outcome.ok) {
    return { export: false };
  }

  const syncId = payload.outcome.syncId;
  if (!syncId || !payload.originInstanceId) {
    return { export: false };
  }
  if (payload.originInstanceId !== originInstanceId) {
    return { export: false };
  }
  if (lastExportedSyncId === syncId) {
    return { export: false };
  }

  const latest = getLatestSyncOutcomeRecord(db, AUTO_EXPORT_SOURCE);
  if (!latest || !latest.ok) {
    return { export: false };
  }
  if (latest.syncId !== syncId) {
    return { export: false };
  }
  if (latest.originInstanceId !== originInstanceId) {
    return { export: false };
  }
  if (
    latest.counts.inserted !== payload.outcome.counts.inserted ||
    latest.counts.updated !== payload.outcome.counts.updated ||
    latest.fetched !== payload.outcome.fetched
  ) {
    return { export: false };
  }

  return { export: true, syncId };
}

/**
 * Auto-export after a successful full sync (spec §9).
 * Silent no-op when no destination is configured. Listener failures are
 * swallowed by the sync-success hook, so a failed export never breaks sync
 * persistence.
 *
 * Partial source outcomes (dlsite / fanza_*) never export. Only the
 * canonical `full_sync` success path does, at most once per syncId, and only
 * when this install is the originator of the persisted outcome.
 */
export function installAutoExport(
  db: DatabaseSync,
  port: number,
  options: InstallAutoExportOptions = {},
): () => void {
  const runExport = options.exportSnapshot ?? exportSnapshot;
  const originInstanceId = options.originInstanceId ?? randomUUID();
  // Bind before any later persist on this handle so outcomes carry our origin.
  bindOriginInstanceId(db, originInstanceId);

  // An already-persisted outcome predates this listener only when its origin
  // matches. Seeding the dedupe fence prevents replay of our own stale outcome
  // after restart; foreign-origin rows are ignored by origin checks.
  const seeded = getLatestSyncOutcomeRecord(db, AUTO_EXPORT_SOURCE);
  let lastExportedSyncId =
    seeded && seeded.originInstanceId === originInstanceId ? seeded.syncId : null;

  return subscribeSyncSuccess((payload) => {
    const decision = shouldAutoExportForDb(
      db,
      payload,
      originInstanceId,
      lastExportedSyncId,
    );
    if (!decision.export) return;

    const destination = loadAdminSettings(db, port).exportDestination.trim();
    if (!destination) return;

    runExport(db, destination);
    lastExportedSyncId = decision.syncId;
  });
}
