/* global Buffer, console, process */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CANDIDATE_WORKFLOW = "Release candidate";
const ZIP_EPOCH_DATE = 33; // 1980-01-01 in the DOS date format.
const ADMIN_DIST_FILES = ["index.html", "main.js", "styles.css"];

function fail(message) {
  throw new Error(message);
}

function clearCandidateOutput(path) {
  const safeRoots = [resolve(ROOT) + sep, resolve(tmpdir()) + sep];
  if (!safeRoots.some((root) => path.startsWith(root))) {
    fail(`candidate output must be below the repository or temp directory: ${path}`);
  }
  rmSync(path, { recursive: true, force: true });
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`invalid JSON ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function run(command, args, cwd, { quiet = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  if (!quiet) {
    process.stdout.write(stdout);
    process.stderr.write(stderr);
  }
  return {
    command: [command, ...args].join(" "),
    exit_code: result.status ?? 1,
    status: result.status === 0 ? "PASS" : "FAIL",
    output: `${stdout}\n${stderr}`,
  };
}

function git(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) {
    fail(`git ${args.join(" ")} failed: ${(result.stderr ?? "").trim()}`);
  }
  return (result.stdout ?? "").trim();
}

function parseVersion(tag) {
  const match = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(tag);
  if (!match) fail(`invalid release tag: ${tag} (expected vMAJOR.MINOR.PATCH)`);
  return match[1];
}

function verifyNodeVersion() {
  if (!process.versions.node.startsWith("22.")) {
    fail(`unsupported Node.js ${process.versions.node} (Release candidates require Node.js 22.x)`);
  }
}

function verifyGitTag(tag) {
  const commit = git(["rev-parse", "--verify", `refs/tags/${tag}^{commit}`]);
  const head = git(["rev-parse", "HEAD"]);
  if (commit !== head) fail(`HEAD ${head} does not match tag ${tag} at ${commit}`);

  if (git(["status", "--porcelain=v1"])) {
    fail("checkout is not clean");
  }

  let mainRef;
  try {
    mainRef = git(["rev-parse", "--verify", "refs/remotes/origin/main"]);
  } catch {
    mainRef = git(["rev-parse", "--verify", "refs/heads/main"]);
  }
  const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", commit, mainRef], {
    cwd: ROOT,
  });
  if (ancestor.status !== 0) fail(`${tag} is not on protected main`);
  return commit;
}

function copyFile(source, destination) {
  const stat = lstatSync(source);
  if (!stat.isFile()) fail(`expected regular file: ${source}`);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, readFileSync(source), { mode: 0o644 });
  chmodSync(destination, 0o644);
}

function copyTree(sourceRoot, destinationRoot, predicate) {
  const walk = (current, prefix = "") => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const source = join(current, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) fail(`symlink is not allowed: ${source}`);
      if (entry.isDirectory()) {
        walk(source, rel);
        continue;
      }
      if (!entry.isFile()) fail(`non-regular file is not allowed: ${source}`);
      if (predicate(rel)) copyFile(source, join(destinationRoot, rel));
    }
  };

  if (!existsSync(sourceRoot)) fail(`missing build output: ${sourceRoot}`);
  walk(sourceRoot);
}

function listFiles(root) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) fail(`symlink is not allowed: ${path}`);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.isFile()) fail(`non-regular file is not allowed: ${path}`);
      files.push(relative(root, path).split(sep).join("/"));
    }
  };
  walk(root);
  return files.sort();
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(root, destination) {
  // ponytail: ZIP32/store keeps hashes stable; add deflate/ZIP64 if bundles exceed 4 GiB.
  const files = listFiles(root);
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const name of files) {
    const nameBuffer = Buffer.from(name, "utf8");
    const data = readFileSync(join(root, ...name.split("/")));
    if (data.length > 0xffffffff || offset > 0xffffffff) fail("bundle is too large for ZIP32");
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6); // UTF-8 names.
    local.writeUInt16LE(0, 8); // Store: no compressor-dependent output.
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(ZIP_EPOCH_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuffer, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x800, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(ZIP_EPOCH_DATE, 14);
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuffer.length, 28);
    entry.writeUInt16LE(0, 30);
    entry.writeUInt16LE(0, 32);
    entry.writeUInt16LE(0, 34);
    entry.writeUInt16LE(0, 36);
    entry.writeUInt32LE(0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }

  const centralDirectory = Buffer.concat(central);
  if (centralDirectory.length > 0xffffffff || offset > 0xffffffff) fail("bundle is too large for ZIP32");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, Buffer.concat([...chunks, centralDirectory, end]), { mode: 0o644 });
  return files;
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 22 - 0xffff);
  for (let offset = buffer.length - 22; offset >= minimum; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  fail("ZIP end record is missing");
}

function readZip(path) {
  const buffer = readFileSync(path);
  const endOffset = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    fail("ZIP64 is not supported");
  }
  if (centralOffset + centralSize > endOffset) fail("ZIP central directory is out of bounds");

  const entries = [];
  let cursor = centralOffset;
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) fail("invalid ZIP central entry");
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const checksum = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    cursor += 46 + nameLength + extraLength + commentLength;
    if (flags & 1 || flags & 8 || method !== 0) fail(`unsupported ZIP entry: ${name}`);
    const unixMode = externalAttributes >>> 16;
    if (externalAttributes & 0x10 || (unixMode && (unixMode & 0xf000) !== 0x8000)) {
      fail(`non-regular ZIP entry: ${name}`);
    }
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      fail(`invalid ZIP local entry: ${name}`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length || compressedSize !== uncompressedSize) fail(`invalid ZIP data: ${name}`);
    const data = Buffer.from(buffer.subarray(dataStart, dataEnd));
    if (crc32(data) !== checksum) fail(`ZIP CRC mismatch: ${name}`);
    entries.push({ name, data });
  }
  if (cursor !== centralOffset + centralSize) fail("ZIP central directory length mismatch");
  return entries;
}

function safeArchivePath(name) {
  if (!name || name.startsWith("/") || name.includes("\\") || name.includes("\0")) {
    fail(`unsafe archive path: ${name}`);
  }
  const parts = name.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    fail(`unsafe archive path: ${name}`);
  }
  return parts;
}

function extractZip(path, destination) {
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  for (const entry of readZip(path)) {
    const parts = safeArchivePath(entry.name);
    const target = join(destination, ...parts);
    const root = resolve(destination) + sep;
    if (!resolve(target).startsWith(root)) fail(`archive escapes extraction root: ${entry.name}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.data, { mode: 0o644 });
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function testCount(output) {
  return [...output.matchAll(/\btests\s+(\d+)/g)].reduce(
    (sum, match) => sum + Number(match[1]),
    0,
  );
}

function auditSummary(output) {
  const warnings = [
    ...new Set(
      output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(
          (line) =>
            /\b(?:audit|vulnerabilit(?:y|ies)|severity)\b/i.test(line) &&
            !/^found 0 vulnerabilities$/i.test(line),
        ),
    ),
  ].slice(0, 8);
  return { warning_count: warnings.length, warnings };
}

function checkResult(status, extra = {}) {
  return { status: status.status, exit_code: status.exit_code, command: status.command, ...extra };
}

function assertNoCredentials(entries) {
  const signatures = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
    /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  ];
  for (const entry of entries) {
    const text = entry.data.toString("utf8");
    if (signatures.some((signature) => signature.test(text))) {
      fail(`credential signature found in bundle: ${entry.name}`);
    }
  }
}

function assertAllowedBundlePaths(entries) {
  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.name)) fail(`duplicate archive entry: ${entry.name}`);
    seen.add(entry.name);
    const parts = safeArchivePath(entry.name);
    const path = entry.name;
    const allowed =
      path === "extension/manifest.json" ||
      (parts[0] === "server" && parts[1] === "migrations" && path.endsWith(".sql")) ||
      ADMIN_DIST_FILES.some((file) => path === `admin/dist/${file}`) ||
      path === "shared/package.json" ||
      path === "package.json" ||
      path === "package-lock.json" ||
      path === "README.md" ||
      path === "scripts/runtime.mjs" ||
      (parts[0] === "extension" && parts[1] === "dist" && /\.(?:js|html|css)$/.test(path)) ||
      (parts[0] === "server" && parts[1] === "dist" && path.endsWith(".js")) ||
      (parts[0] === "shared" && parts[1] === "dist" && path.endsWith(".js"));
    if (!allowed) fail(`path is outside distribution allowlist: ${path}`);
    if (/\.map$|\.d\.ts$|(?:^|\/)(?:\.git|node_modules|prototype|tests?|docs)(?:\/|$)/i.test(path)) {
      fail(`forbidden distribution path: ${path}`);
    }
  }
  const required = [
    "extension/manifest.json",
    "server/dist/static.js",
    "server/migrations/001_initial.sql",
    ...ADMIN_DIST_FILES.map((file) => `admin/dist/${file}`),
    "shared/package.json",
    "shared/dist/index.js",
    "package.json",
    "package-lock.json",
    "README.md",
    "scripts/runtime.mjs",
  ];
  for (const path of required) {
    if (!seen.has(path)) fail(`bundle is missing required file: ${path}`);
  }
}

function assertManifest(entries, version) {
  const files = new Map(entries.map((entry) => [entry.name, entry.data]));
  const raw = files.get("extension/manifest.json");
  if (!raw) fail("extension manifest is missing");
  const manifest = JSON.parse(raw.toString("utf8"));
  if (manifest.version !== version) {
    fail(`manifest version ${manifest.version} does not match ${version}`);
  }
  const refs = [manifest.background?.service_worker, manifest.action?.default_popup];
  for (const script of manifest.content_scripts ?? []) refs.push(...(script.js ?? []));
  for (const ref of refs) {
    if (typeof ref !== "string" || ref.includes("..") || ref.startsWith("/")) {
      fail(`unsafe manifest reference: ${String(ref)}`);
    }
    if (!files.has(`extension/${ref}`)) fail(`manifest reference is missing: extension/${ref}`);
  }
}

function verifyBundleEntries(entries, version) {
  assertAllowedBundlePaths(entries);
  assertManifest(entries, version);
  assertNoCredentials(entries);
}

function buildRuntimePackage(version, zodVersion) {
  return {
    name: "avoid-duplicate-purchases-runtime",
    version,
    private: true,
    type: "module",
    scripts: {
      setup: "node scripts/runtime.mjs setup",
      start: "node scripts/runtime.mjs start",
      stop: "node scripts/runtime.mjs stop",
      restart: "node scripts/runtime.mjs restart",
      status: "node scripts/runtime.mjs status",
    },
    dependencies: {
      "@adp/shared": "file:./shared",
      zod: zodVersion,
    },
  };
}

function stageBundle(staging, version) {
  const sharedPackagePath = join(ROOT, "shared/package.json");
  const sourceLock = readJson(join(ROOT, "package-lock.json"));
  const zodVersion = sourceLock.packages?.["node_modules/zod"]?.version;
  if (!zodVersion) fail("source package-lock.json has no resolved zod version");

  copyFile(join(ROOT, "extension/manifest.json"), join(staging, "extension/manifest.json"));
  copyTree(join(ROOT, "extension/dist"), join(staging, "extension/dist"), (path) =>
    /\.(?:js|html|css)$/.test(path) && !/(^|\/)tests?(\/|$)/.test(path),
  );
  copyTree(join(ROOT, "server/dist"), join(staging, "server/dist"), (path) => path.endsWith(".js"));
  copyTree(join(ROOT, "server/migrations"), join(staging, "server/migrations"), (path) =>
    path.endsWith(".sql"),
  );
  for (const file of ADMIN_DIST_FILES) {
    copyFile(join(ROOT, "admin/dist", file), join(staging, "admin/dist", file));
  }
  copyFile(sharedPackagePath, join(staging, "shared/package.json"));
  copyTree(join(ROOT, "shared/dist"), join(staging, "shared/dist"), (path) => path.endsWith(".js"));
  copyFile(join(ROOT, "README.md"), join(staging, "README.md"));
  copyFile(join(ROOT, "scripts/runtime.mjs"), join(staging, "scripts/runtime.mjs"));
  writeJson(join(staging, "package.json"), buildRuntimePackage(version, zodVersion));

  const lock = run(
    npmCommand(),
    ["install", "--package-lock-only", "--ignore-scripts", "--omit=dev"],
    staging,
  );
  if (lock.status !== "PASS") fail("could not create runtime package-lock.json");
  if (existsSync(join(staging, "node_modules"))) rmSync(join(staging, "node_modules"), { recursive: true, force: true });
  const files = listFiles(staging);
  if (!files.includes("package-lock.json")) fail("runtime package-lock.json was not generated");
  return files;
}

function verifyCandidateFiles(directory, tag, runId) {
  const version = parseVersion(tag);
  const metadataPath = join(directory, "RELEASE.json");
  const checksumsPath = join(directory, "SHA256SUMS");
  const metadata = readJson(metadataPath);
  if (metadata.schema !== 1 || metadata.workflow !== CANDIDATE_WORKFLOW) fail("invalid candidate metadata");
  if (metadata.tag !== tag || metadata.version !== version) fail("candidate tag/version mismatch");
  if (String(metadata.candidate_run_id) !== String(runId)) fail("candidate run id mismatch");
  if (typeof metadata.runtime?.node !== "string" || !metadata.runtime.node.startsWith("v22.")) {
    fail("candidate was not generated with Node.js 22.x");
  }

  const commit = verifyGitTag(tag);
  if (metadata.commit !== commit) fail("candidate commit mismatch");
  const bundleName = `avoid-duplicate-purchases-${tag}.zip`;
  if (metadata.bundle?.filename !== bundleName) fail("candidate bundle name mismatch");
  const bundlePath = join(directory, bundleName);
  if (!existsSync(bundlePath)) fail("candidate bundle is missing");
  const digest = sha256(bundlePath);
  const size = statSync(bundlePath).size;
  if (metadata.bundle.sha256 !== digest || metadata.bundle.size_bytes !== size) {
    fail("candidate bundle checksum or size mismatch");
  }
  if (readFileSync(checksumsPath, "utf8") !== `${digest}  ${bundleName}\n`) {
    fail("SHA256SUMS does not match candidate bundle");
  }
  const entries = readZip(bundlePath);
  verifyBundleEntries(entries, version);
  const requiredChecks = [
    "npm ci",
    "npm run build",
    "npm test",
    "manifest",
    "contamination",
    "archive",
    "reproducibility",
    "npm ci --omit=dev",
  ];
  for (const name of requiredChecks) {
    const value = metadata.checks?.[name];
    if (!value || value.status !== "PASS") fail(`candidate check did not pass: ${name}`);
  }
  for (const name of ["npm ci", "npm run build", "npm test", "npm ci --omit=dev"]) {
    const value = metadata.checks[name];
    if (typeof value.command !== "string" || typeof value.exit_code !== "number" || value.exit_code !== 0) {
      fail(`candidate command evidence is incomplete: ${name}`);
    }
  }
  if (!Number.isInteger(metadata.checks["npm test"].test_count)) {
    fail("candidate test count is missing");
  }
  if (!Array.isArray(metadata.checks["npm ci"].audit?.warnings)) {
    fail("candidate npm ci audit evidence is missing");
  }
  const names = readdirSync(directory).sort();
  const expected = [bundleName, "RELEASE.json", "SHA256SUMS"].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) fail("candidate artifact has unexpected files");
  return { metadata, bundlePath, version, digest };
}

function getOption(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function requireOption(args, name) {
  const value = getOption(args, name);
  if (!value) fail(`${name} is required`);
  return value;
}

function candidate(args) {
  const tag = getOption(args, "--tag", process.env.RELEASE_TAG);
  if (!tag) fail("--tag or RELEASE_TAG is required");
  const version = parseVersion(tag);
  const output = resolve(ROOT, getOption(args, "--output", process.env.RELEASE_OUTPUT_DIR ?? "release-candidate"));
  const temp = mkdtempSync(join(tmpdir(), "adp-release-"));
  clearCandidateOutput(output);
  try {
    const commit = verifyGitTag(tag);
    verifyNodeVersion();
    const manifest = readJson(join(ROOT, "extension/manifest.json"));
    if (manifest.version !== version) fail(`manifest version ${manifest.version} does not match ${version}`);

    const npmCi = run(npmCommand(), ["ci"], ROOT);
    if (npmCi.status !== "PASS") fail("npm ci failed");
    const build = run(npmCommand(), ["run", "build"], ROOT);
    if (build.status !== "PASS") fail("npm run build failed");
    const tests = run(npmCommand(), ["test"], ROOT);
    if (tests.status !== "PASS") fail("npm test failed");

    const staging = join(temp, "bundle");
    mkdirSync(staging, { recursive: true });
    const stagedFiles = stageBundle(staging, version);
    const zipPath = join(temp, `avoid-duplicate-purchases-${tag}.zip`);
    const zipFiles = createZip(staging, zipPath);
    if (JSON.stringify(zipFiles) !== JSON.stringify(stagedFiles)) fail("ZIP file list is not deterministic");
    const entries = readZip(zipPath);
    verifyBundleEntries(entries, version);
    const repeatStaging = join(temp, "repeat-bundle");
    mkdirSync(repeatStaging, { recursive: true });
    const repeatFiles = stageBundle(repeatStaging, version);
    if (JSON.stringify(repeatFiles) !== JSON.stringify(stagedFiles)) fail("bundle file list is not reproducible");
    const repeatZipPath = join(temp, "repeat.zip");
    createZip(repeatStaging, repeatZipPath);
    const digest = sha256(zipPath);
    if (digest !== sha256(repeatZipPath)) fail("ZIP is not reproducible");

    const extracted = join(temp, "extracted");
    extractZip(zipPath, extracted);
    const runtimeInstall = run(npmCommand(), ["ci", "--omit=dev"], extracted);
    if (runtimeInstall.status !== "PASS") fail("bundle npm ci --omit=dev failed");

    const npmVersion = run(npmCommand(), ["--version"], ROOT, { quiet: true });
    const checks = {
      "npm ci": checkResult(npmCi, { audit: auditSummary(npmCi.output) }),
      "npm run build": checkResult(build),
      "npm test": checkResult(tests, { test_count: testCount(tests.output) }),
      manifest: { status: "PASS", version: manifest.version },
      contamination: { status: "PASS", credential_signatures: "none" },
      archive: { status: "PASS", entries: entries.length },
      reproducibility: { status: "PASS", sha256: digest },
      "npm ci --omit=dev": checkResult(runtimeInstall),
    };
    const metadata = {
      schema: 1,
      workflow: CANDIDATE_WORKFLOW,
      candidate_run_id: process.env.GITHUB_RUN_ID ?? "local",
      tag,
      version,
      commit,
      bundle: {
        filename: `avoid-duplicate-purchases-${tag}.zip`,
        size_bytes: statSync(zipPath).size,
        sha256: digest,
      },
      runtime: { node: process.version, npm: npmVersion.output.trim() },
      checks,
    };

    const artifacts = join(temp, "artifacts");
    mkdirSync(artifacts, { recursive: true });
    renameSync(zipPath, join(artifacts, metadata.bundle.filename));
    writeFileSync(join(artifacts, "SHA256SUMS"), `${digest}  ${metadata.bundle.filename}\n`, { mode: 0o644 });
    writeJson(join(artifacts, "RELEASE.json"), metadata);
    mkdirSync(dirname(output), { recursive: true });
    renameSync(artifacts, output);
    console.log(`Release candidate ready: ${output}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function releaseNotes(args) {
  const directory = resolve(requireOption(args, "--dir"));
  const tag = requireOption(args, "--tag");
  const manualSmoke = getOption(args, "--manual-smoke", process.env.MANUAL_SMOKE_TEST);
  if (manualSmoke !== "PASS") fail("manual smoke test must be PASS before publishing");
  const { metadata, version, digest } = verifyCandidateFiles(
    directory,
    tag,
    requireOption(args, "--run-id"),
  );
  const out = resolve(requireOption(args, "--output"));
  const checks = metadata.checks;
  const notes = `## AvoidDuplicatePurchases v${version}

Official distribution: GitHub Release assets only.
This is not a listing on another distribution channel and does not deliver to an operational environment.

### Traceability
- Tag: ${tag}
- Commit: ${metadata.commit}
- Release candidate run: ${metadata.candidate_run_id}
- Bundle: ${metadata.bundle.filename}
- SHA-256: ${digest}

### Verification
- npm ci: ${checks["npm ci"].status}
- npm run build: ${checks["npm run build"].status}
- npm test: ${checks["npm test"].status} (${checks["npm test"].test_count ?? "unknown"} tests)
- npm ci --omit=dev: ${checks["npm ci --omit=dev"].status}
- Manual smoke test: PASS
- Evidence: RELEASE.json, SHA256SUMS

### Supported environment
- Google Chrome Desktop, MV3
- Node.js 22.x
- localhost server at 127.0.0.1:41321
- Installation details: README.md in the bundle

### Out of scope
- Chrome Web Store / Edge Add-ons / Firefox Add-ons
- delivery to an operational server
- page intervention for FANZA video and PC games

### Known limitations
- Edge and other Chromium-derived browsers are unverified.
- The port is fixed at 127.0.0.1:41321.
- DB backup is the user's responsibility.
- Upstream private API changes may require a later update.
`;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, notes, { mode: 0o644 });
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "candidate") return candidate(args);
  if (command === "verify-candidate") {
    const directory = resolve(requireOption(args, "--dir"));
    verifyCandidateFiles(directory, requireOption(args, "--tag"), requireOption(args, "--run-id"));
    console.log("candidate verification passed");
    return;
  }
  if (command === "release-notes") return releaseNotes(args);
  fail("usage: node scripts/release.mjs candidate|verify-candidate|release-notes ...");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
