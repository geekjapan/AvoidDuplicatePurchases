import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  realpathSync,
  renameSync,
  rmSync,
  type Stats,
} from "node:fs";
import { isAbsolute, join, parse as parsePath, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";

/** Snapshot filename written into the configured sync folder (spec §9). */
export const EXPORT_FILENAME = "adp-export.sqlite";

const TEMP_DIR_PREFIX = ".adp-export-";
const EXPORT_DIR_MODE = 0o700;
const EXPORT_FILE_MODE = 0o600;

export interface ExportResult {
  /** Absolute path of the written snapshot. */
  path: string;
}

interface DirectoryPin {
  path: string;
  realPath: string;
  dev: number;
  ino: number;
  fd: number | null;
}

interface PathIdentity {
  dev: number;
  ino: number;
  isDirectory: boolean;
  isFile: boolean;
  isSymbolicLink: boolean;
}

interface ExportSnapshotOptions {
  /** Failure-injection seams. Production callers leave these unset. */
  renameSync?: (from: string, to: string) => void;
  rmSync?: (
    path: string,
    opts?: { force?: boolean; recursive?: boolean },
  ) => void;
  afterPin?: (pin: Readonly<Omit<DirectoryPin, "fd">>) => void;
  afterTempDir?: (
    tempDir: string,
    pin: Readonly<Omit<DirectoryPin, "fd">>,
  ) => void;
  afterVacuum?: (tempFile: string) => void;
}

const DIR_OPEN_FLAGS =
  fsConstants.O_RDONLY |
  (fsConstants.O_DIRECTORY ?? 0) |
  (fsConstants.O_NOFOLLOW ?? 0);

function isEnoent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function pathIdentity(path: string): PathIdentity | null {
  let stats: Stats;
  try {
    stats = lstatSync(path);
  } catch (error) {
    if (isEnoent(error)) return null;
    throw error;
  }
  return {
    dev: stats.dev,
    ino: stats.ino,
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
    isSymbolicLink: stats.isSymbolicLink(),
  };
}

function sameIdentity(actual: PathIdentity, expected: PathIdentity): boolean {
  return (
    actual.dev === expected.dev &&
    actual.ino === expected.ino &&
    actual.isDirectory === expected.isDirectory &&
    actual.isFile === expected.isFile &&
    actual.isSymbolicLink === expected.isSymbolicLink
  );
}

/**
 * macOS exposes a few root-owned compatibility aliases (`/var`, `/tmp`,
 * `/etc`). Canonicalize those roots before component validation; descendant
 * symlinks remain forbidden. The logical path is retained for the API result.
 */
function canonicalOperationPath(logicalPath: string): string {
  if (process.platform !== "darwin") return logicalPath;

  const { root } = parsePath(logicalPath);
  const parts = logicalPath
    .slice(root.length)
    .split(sep)
    .filter((part) => part.length > 0);
  const first = parts[0];
  if (!first || !new Set(["etc", "tmp", "var"]).has(first)) {
    return logicalPath;
  }

  const alias = join(root, first);
  const identity = pathIdentity(alias);
  if (!identity?.isSymbolicLink) return logicalPath;
  return resolve(realpathSync(alias), ...parts.slice(1));
}

function assertNoSymlinkComponents(absolutePath: string): void {
  const { root } = parsePath(absolutePath);
  let current = root;
  const parts = absolutePath
    .slice(root.length)
    .split(sep)
    .filter((part) => part.length > 0);

  for (const part of parts) {
    current = join(current, part);
    const identity = pathIdentity(current);
    if (!identity) return;
    if (identity.isSymbolicLink) {
      throw new Error("export path must not contain a symbolic link component");
    }
  }
}

function ensureDestinationDirectory(destination: string): void {
  assertNoSymlinkComponents(destination);
  const existing = pathIdentity(destination);
  if (existing) {
    if (existing.isSymbolicLink) {
      throw new Error("export path must not be a symbolic link");
    }
    if (!existing.isDirectory) {
      throw new Error("export destination must be a directory");
    }
    return; // Never rewrite permissions on an existing directory.
  }

  mkdirSync(destination, { recursive: true, mode: EXPORT_DIR_MODE });
  assertNoSymlinkComponents(destination);
  if (process.platform !== "win32") {
    // mkdir mode is umask-sensitive; the required final leaf mode is exact.
    chmodSync(destination, EXPORT_DIR_MODE);
  }
}

function pinDirectory(path: string): DirectoryPin {
  assertNoSymlinkComponents(path);
  if (process.platform === "win32") {
    // Node does not expose a Windows directory-handle/openat equivalent here.
    // Retain the strongest stdlib checks available without claiming POSIX fd
    // pinning or ACL semantics.
    const stats = lstatSync(path);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error("export destination must be a non-symlink directory");
    }
    return {
      path,
      realPath: realpathSync(path),
      dev: stats.dev,
      ino: stats.ino,
      fd: null,
    };
  }

  const fd = openSync(path, DIR_OPEN_FLAGS);
  try {
    const stats = fstatSync(fd);
    if (!stats.isDirectory()) {
      throw new Error("export destination must be a directory");
    }
    const realPath = realpathSync(path);
    const leaf = pathIdentity(path);
    if (!leaf || leaf.isSymbolicLink) {
      throw new Error("export path must not be a symbolic link");
    }
    if (leaf.dev !== stats.dev || leaf.ino !== stats.ino) {
      throw new Error("export destination replaced during export");
    }
    return { path, realPath, dev: stats.dev, ino: stats.ino, fd };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function publicPin(pin: DirectoryPin): Omit<DirectoryPin, "fd"> {
  return {
    path: pin.path,
    realPath: pin.realPath,
    dev: pin.dev,
    ino: pin.ino,
  };
}

function revalidatePinnedDirectory(pin: DirectoryPin): void {
  if (pin.fd !== null) {
    const pinnedStats = fstatSync(pin.fd);
    if (
      !pinnedStats.isDirectory() ||
      pinnedStats.dev !== pin.dev ||
      pinnedStats.ino !== pin.ino
    ) {
      throw new Error("export destination pin changed during export");
    }
  }

  assertNoSymlinkComponents(pin.path);
  if (process.platform === "win32") {
    const current = lstatSync(pin.path);
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      current.dev !== pin.dev ||
      current.ino !== pin.ino ||
      realpathSync(pin.path) !== pin.realPath
    ) {
      throw new Error("export destination replaced during export");
    }
    return;
  }

  let fd: number | undefined;
  try {
    fd = openSync(pin.path, DIR_OPEN_FLAGS);
    const current = fstatSync(fd);
    if (
      !current.isDirectory() ||
      current.dev !== pin.dev ||
      current.ino !== pin.ino ||
      realpathSync(pin.path) !== pin.realPath
    ) {
      throw new Error("export destination replaced during export");
    }
  } catch (error) {
    if ((error as Error).message?.includes("export destination")) throw error;
    if ((error as Error).message?.includes("symbolic link")) throw error;
    throw new Error(
      `export destination revalidation failed: ${(error as Error).message ?? String(error)}`,
    );
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function requirePathIdentity(
  path: string,
  expectedType: "directory" | "file",
  pin: DirectoryPin,
): PathIdentity {
  const identity = pathIdentity(path);
  if (!identity) throw new Error("export temporary path disappeared");
  if (identity.isSymbolicLink) {
    throw new Error("export temporary path must not be a symbolic link");
  }
  if (expectedType === "directory" && !identity.isDirectory) {
    throw new Error("export temporary directory replaced during export");
  }
  if (expectedType === "file" && !identity.isFile) {
    throw new Error("export temporary file replaced during export");
  }
  if (identity.dev !== pin.dev) {
    throw new Error("export temporary path left the destination filesystem");
  }

  const parent = expectedType === "directory" ? join(path, "..") : join(path, "..", "..");
  if (realpathSync(parent) !== pin.realPath) {
    throw new Error("export temporary path escaped configured destination");
  }
  return identity;
}

function requireStagedIdentity(path: string, pin: DirectoryPin): PathIdentity {
  const identity = pathIdentity(path);
  if (!identity || identity.isSymbolicLink || !identity.isFile) {
    throw new Error("export staged file replaced during export");
  }
  if (identity.dev !== pin.dev || realpathSync(join(path, "..")) !== pin.realPath) {
    throw new Error("export staged file escaped configured destination");
  }
  return identity;
}

function applySnapshotMode(path: string): void {
  if (process.platform === "win32") {
    // Node mode bits cannot express Windows ACL equivalence to POSIX 0600.
    return;
  }
  chmodSync(path, EXPORT_FILE_MODE);
}

function errorValue(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function aggregate(primary: unknown, cleanupErrors: Error[]): never {
  const errors =
    primary instanceof AggregateError
      ? primary.errors.map(errorValue)
      : primary === undefined
        ? []
        : [errorValue(primary)];
  errors.push(...cleanupErrors);
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(errors, "export failed with cleanup errors");
}

/** Remove only the inode created by this export and always verify absence. */
function removeCreatedPath(
  path: string,
  expected: PathIdentity,
  recursive: boolean,
  remove: NonNullable<ExportSnapshotOptions["rmSync"]>,
): Error[] {
  const errors: Error[] = [];
  try {
    const current = pathIdentity(path);
    if (current && !sameIdentity(current, expected)) {
      if (current.isSymbolicLink) {
        // rm of the link itself does not traverse its target. Never recurse
        // through a replacement directory or delete an unrelated regular file.
        remove(path, { force: true, recursive: false });
      } else {
        throw new Error(`refusing cleanup of replaced export path: ${path}`);
      }
    } else if (current) {
      remove(path, { force: true, recursive });
    }
  } catch (error) {
    errors.push(errorValue(error));
  }

  try {
    if (pathIdentity(path)) {
      errors.push(new Error(`export cleanup left residual path: ${path}`));
    }
  } catch (error) {
    errors.push(
      new Error(`export cleanup verification failed for ${path}: ${errorValue(error).message}`),
    );
  }
  return errors;
}

/**
 * Write a complete SQLite snapshot through an exclusive same-filesystem staging
 * area. Every path component and inode is revalidated around VACUUM and rename.
 * Cleanup completes before the final atomic target replacement, so a reported
 * cleanup failure cannot replace an existing snapshot.
 */
export function exportSnapshot(
  db: DatabaseSync,
  destination: string,
  options: ExportSnapshotOptions = {},
): ExportResult {
  const trimmed = destination.trim();
  if (!isAbsolute(trimmed)) {
    throw new Error("export destination must be absolute");
  }
  const logicalDestination = resolve(trimmed);
  const operationDestination = canonicalOperationPath(logicalDestination);

  ensureDestinationDirectory(operationDestination);
  const pin = pinDirectory(operationDestination);
  const remove = options.rmSync ?? rmSync;
  const finalRename = options.renameSync ?? renameSync;
  const target = join(operationDestination, EXPORT_FILENAME);

  let tempDir: string | undefined;
  let tempDirIdentity: PathIdentity | undefined;
  let stagedFile: string | undefined;
  let stagedIdentity: PathIdentity | undefined;
  let primaryError: unknown;
  let completed = false;

  try {
    options.afterPin?.(publicPin(pin));
    revalidatePinnedDirectory(pin);

    const existingTarget = pathIdentity(target);
    if (existingTarget?.isSymbolicLink) {
      throw new Error("export target must not be a symbolic link");
    }
    if (existingTarget && !existingTarget.isFile) {
      throw new Error("export target must be a regular file");
    }

    tempDir = mkdtempSync(join(operationDestination, TEMP_DIR_PREFIX));
    tempDirIdentity = requirePathIdentity(tempDir, "directory", pin);
    options.afterTempDir?.(tempDir, publicPin(pin));
    revalidatePinnedDirectory(pin);
    tempDirIdentity = requirePathIdentity(tempDir, "directory", pin);

    const tempFile = join(tempDir, EXPORT_FILENAME);
    db.prepare("VACUUM INTO ?").run(tempFile);
    revalidatePinnedDirectory(pin);
    requirePathIdentity(tempFile, "file", pin);
    applySnapshotMode(tempFile);

    options.afterVacuum?.(tempFile);
    revalidatePinnedDirectory(pin);
    requirePathIdentity(tempFile, "file", pin);

    // Move the complete snapshot out of its temp directory, then remove and
    // verify the directory before touching the existing target.
    stagedFile = `${tempDir}.sqlite`;
    if (pathIdentity(stagedFile)) {
      throw new Error("exclusive export staging path already exists");
    }
    renameSync(tempFile, stagedFile);
    stagedIdentity = requireStagedIdentity(stagedFile, pin);

    const preRenameCleanup = removeCreatedPath(
      tempDir,
      tempDirIdentity,
      true,
      remove,
    );
    if (preRenameCleanup.length > 0) aggregate(undefined, preRenameCleanup);
    tempDir = undefined;
    tempDirIdentity = undefined;

    revalidatePinnedDirectory(pin);
    stagedIdentity = requireStagedIdentity(stagedFile, pin);
    const currentTarget = pathIdentity(target);
    if (currentTarget?.isSymbolicLink) {
      throw new Error("export target must not be a symbolic link");
    }
    if (currentTarget && !currentTarget.isFile) {
      throw new Error("export target must be a regular file");
    }

    finalRename(stagedFile, target);
    stagedFile = undefined;
    stagedIdentity = undefined;

    revalidatePinnedDirectory(pin);
    const finalTarget = pathIdentity(target);
    if (!finalTarget?.isFile || finalTarget.isSymbolicLink || finalTarget.dev !== pin.dev) {
      throw new Error("export target invalid after rename");
    }
    if (process.platform !== "win32" && (lstatSync(target).mode & 0o777) !== EXPORT_FILE_MODE) {
      throw new Error("export target permissions changed during rename");
    }
    completed = true;
  } catch (error) {
    primaryError = error;
  } finally {
    if (pin.fd !== null) closeSync(pin.fd);
  }

  const cleanupErrors: Error[] = [];
  if (stagedFile && stagedIdentity) {
    cleanupErrors.push(...removeCreatedPath(stagedFile, stagedIdentity, false, remove));
  }
  if (tempDir && tempDirIdentity) {
    cleanupErrors.push(...removeCreatedPath(tempDir, tempDirIdentity, true, remove));
  }

  if (!completed || primaryError !== undefined || cleanupErrors.length > 0) {
    aggregate(primaryError ?? new Error("export did not complete"), cleanupErrors);
  }

  return { path: join(logicalDestination, EXPORT_FILENAME) };
}
