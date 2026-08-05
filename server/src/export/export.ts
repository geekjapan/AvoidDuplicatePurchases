import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

/** Snapshot filename written into the configured sync folder (spec §9). */
export const EXPORT_FILENAME = "adp-export.sqlite";

/** SQLite string-literal quoting for the VACUUM INTO target. */
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface ExportResult {
  /** Absolute path of the written snapshot. */
  path: string;
}

/**
 * Write a complete SQLite snapshot via VACUUM INTO.
 *
 * Atomicity: VACUUM INTO goes to a `.tmp` sibling first, then an atomic
 * rename replaces the previous snapshot — a failed export never leaves a
 * partial or missing `adp-export.sqlite`. The destination is created on
 * demand and must be an absolute path (enforced by the settings contract).
 */
export function exportSnapshot(db: DatabaseSync, destination: string): ExportResult {
  const dest = destination.trim();
  if (!isAbsolute(dest)) throw new Error("export destination must be absolute");
  mkdirSync(dest, { recursive: true });
  const target = join(dest, EXPORT_FILENAME);
  const tmp = join(dest, `${EXPORT_FILENAME}.tmp`);
  if (existsSync(tmp)) rmSync(tmp);
  db.exec(`VACUUM INTO ${quoteLiteral(tmp)}`);
  renameSync(tmp, target);
  return { path: target };
}
