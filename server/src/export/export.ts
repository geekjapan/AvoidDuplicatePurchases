import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

/** Snapshot filename written into the configured sync folder (spec §9). */
export const EXPORT_FILENAME = "adp-export.sqlite";

/** Prefix for exclusive temp directories created next to the target snapshot. */
const TEMP_DIR_PREFIX = ".adp-export-";

export interface ExportResult {
  /** Absolute path of the written snapshot. */
  path: string;
}

/**
 * Optional seams used only by failure-injection tests.
 * Production callers leave this unset.
 */
export interface ExportSnapshotOptions {
  /** Override rename (inject EISDIR / EACCES failures). */
  renameSync?: (from: string, to: string) => void;
  /** Called after VACUUM INTO writes the temp file, before rename. */
  afterVacuum?: (tempFile: string) => void;
}

function assertNotSymlink(path: string): void {
  let st;
  try {
    st = lstatSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  if (st.isSymbolicLink()) {
    throw new Error("export path must not be a symbolic link");
  }
}

function forceRemove(path: string, recursive = false): void {
  try {
    rmSync(path, { force: true, recursive });
  } catch {
    // Best-effort cleanup: a failed remove must not mask the primary error.
  }
}

/**
 * Write a complete SQLite snapshot via parameterized VACUUM INTO.
 *
 * Atomicity and TOCTOU hardening:
 * - Exclusive, unpredictable temp directory on the same filesystem as `dest`
 *   (mkdtemp), never a fixed `*.tmp` name with exists→rm→reopen.
 * - Symlink destinations are refused via lstat (no write-through outside the
 *   configured folder).
 * - VACUUM INTO binds the path as a parameter (no quoteLiteral / string exec).
 * - Atomic rename replaces the previous snapshot; failures never leave a
 *   partial `adp-export.sqlite` and never preserve residual temp artifacts
 *   (finally force-cleanup).
 */
export function exportSnapshot(
  db: DatabaseSync,
  destination: string,
  options: ExportSnapshotOptions = {},
): ExportResult {
  const dest = destination.trim();
  if (!isAbsolute(dest)) throw new Error("export destination must be absolute");

  mkdirSync(dest, { recursive: true });
  assertNotSymlink(dest);

  const target = join(dest, EXPORT_FILENAME);
  // Refuse to replace / write through a pre-existing symlink at the target.
  assertNotSymlink(target);

  let tempDir: string | undefined;
  let tempFile: string | undefined;
  let renamed = false;
  const doRename = options.renameSync ?? renameSync;

  try {
    tempDir = mkdtempSync(join(dest, TEMP_DIR_PREFIX));
    assertNotSymlink(tempDir);
    tempFile = join(tempDir, EXPORT_FILENAME);

    // Parameterized path — no SQL string interpolation of the destination.
    db.prepare("VACUUM INTO ?").run(tempFile);
    options.afterVacuum?.(tempFile);

    doRename(tempFile, target);
    renamed = true;
    return { path: target };
  } finally {
    // Always force-clean temp artifacts on success (empty dir) and failure.
    // After a successful rename the temp file path is gone; only the dir remains.
    if (!renamed && tempFile !== undefined) {
      forceRemove(tempFile);
    }
    if (tempDir !== undefined) {
      forceRemove(tempDir, true);
    }
  }
}
