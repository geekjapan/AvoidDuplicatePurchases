/* global AbortSignal, console, fetch, process, setTimeout */

import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RUNTIME_DIR = join(ROOT, ".adp");
const CONFIG_PATH = join(RUNTIME_DIR, "config.env");
const PID_PATH = join(RUNTIME_DIR, "server.pid");
const LOG_PATH = join(RUNTIME_DIR, "server.log");
const SERVER_ENTRY = join(ROOT, "server", "dist", "static.js");
const HOST = "127.0.0.1";
const DEFAULT_PORT = 41321;
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";

const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

export function isValidExtensionId(value) {
  return /^[a-p]{32}$/.test(value);
}

function readConfig() {
  return existsSync(CONFIG_PATH) ? readFileSync(CONFIG_PATH, "utf8") : "";
}

function readEnvValue(contents, key) {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*(.*?)\\s*$`, "m").exec(contents);
  if (!match) return "";
  const value = match[1];
  return /^['"].*['"]$/.test(value) ? value.slice(1, -1) : value;
}

export function extensionIdFromConfig(contents) {
  const origin = readEnvValue(contents, "ADP_EXTENSION_ORIGIN");
  const match = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin);
  return match?.[1] ?? "";
}

export function updateEnvFile(contents, key, value) {
  const body = contents.replace(/\r?\n$/, "");
  const lines = body ? body.split(/\r?\n/) : [];
  const assignment = new RegExp(`^\\s*${key}\\s*=`);
  const index = lines.findIndex((line) => assignment.test(line));
  if (index >= 0) lines[index] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  return `${lines.join("\n")}\n`;
}

function saveExtensionId(id) {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  writeFileSync(
    CONFIG_PATH,
    updateEnvFile(readConfig(), "ADP_EXTENSION_ORIGIN", `chrome-extension://${id}`),
    { mode: 0o600 },
  );
  chmodSync(CONFIG_PATH, 0o600);
}

function nodeIsSupported() {
  if (process.versions.node.split(".")[0] === "22") return true;
  console.error(
    `Node.js 22.x が必要です。現在は ${process.version} です。` +
      " https://nodejs.org/en/download/ からNode.js 22.xを導入して、もう一度実行してください。",
  );
  return false;
}

function bundleIsReady() {
  const required = [
    "package-lock.json",
    "extension/manifest.json",
    "admin/dist/index.html",
    "shared/package.json",
    "server/dist/static.js",
  ];
  const missing = required.filter((path) => !existsSync(join(ROOT, path)));
  if (missing.length === 0) return true;
  console.error(
    "配布bundleが不完全です。GitHub Releaseからbundleを展開し、bundle rootで実行してください。" +
      ` 不足: ${missing.join(", ")}`,
  );
  return false;
}

function installRuntimeDependencies() {
  console.log("runtime依存を導入しています（npm ci --omit=dev）…");
  const result = spawnSync(NPM, ["ci", "--omit=dev"], { cwd: ROOT, stdio: "inherit" });
  if (result.error) {
    console.error(`npmを実行できませんでした: ${result.error.message}`);
    return false;
  }
  if (result.status !== 0) {
    console.error("runtime依存の導入に失敗しました。ネットワークとpackage-lock.jsonを確認してください。");
    return false;
  }
  return true;
}

function readPid() {
  if (!existsSync(PID_PATH)) return null;
  const value = Number(readFileSync(PID_PATH, "utf8").trim());
  return Number.isSafeInteger(value) && value > 1 ? value : null;
}

function removePid() {
  rmSync(PID_PATH, { force: true });
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function configuredPort(config) {
  const port = Number(readEnvValue(config, "ADP_PORT") || DEFAULT_PORT);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_PORT;
}

function runtimeEnv(config) {
  const env = { ...process.env };
  for (const key of ["ADP_EXTENSION_ORIGIN", "ADP_DB_PATH", "ADP_PORT", "ADP_READONLY"]) {
    const value = readEnvValue(config, key);
    if (value) env[key] = value;
  }
  return env;
}

async function request(url, headers = {}) {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(1000) });
    await response.arrayBuffer();
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: null };
  }
}

async function probeServer() {
  const config = readConfig();
  const port = configuredPort(config);
  const baseUrl = `http://${HOST}:${port}`;
  const extensionId = extensionIdFromConfig(config);
  const admin = await request(`${baseUrl}/`, { Origin: baseUrl });
  const extension = extensionId
    ? await request(`${baseUrl}/api/sync-state/dlsite`, {
        Origin: `chrome-extension://${extensionId}`,
      })
    : { ok: false, status: null };
  return { admin, baseUrl, extension, extensionId };
}

function checkLabel(result) {
  return result.ok ? `接続済み (${result.status})` : `未接続${result.status ? ` (${result.status})` : ""}`;
}

function printProbe(probe) {
  console.log(`管理画面 ${probe.baseUrl}/: ${checkLabel(probe.admin)}`);
  console.log(`拡張機能 chrome-extension://${probe.extensionId || "未設定"}: ${checkLabel(probe.extension)}`);
}

function logTail() {
  if (!existsSync(LOG_PATH)) return "(server.logはまだありません)";
  const contents = readFileSync(LOG_PATH, "utf8");
  return contents.length > 2000 ? contents.slice(-2000) : contents;
}

function runtimeIsReady() {
  if (!bundleIsReady()) return false;
  if (existsSync(join(ROOT, "node_modules"))) return true;
  console.error("runtime依存が未導入です。先に npm run setup を実行してください。");
  return false;
}

async function waitForServer(pid) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await delay(250);
    if (!isProcessAlive(pid)) return false;
    if ((await probeServer()).admin.ok) return true;
  }
  return false;
}

async function startServer({ announce = true } = {}) {
  if (!nodeIsSupported() || !runtimeIsReady()) return 1;
  if (!existsSync(CONFIG_PATH)) {
    console.error("初回設定がありません。先に npm run setup を実行してください。");
    return 1;
  }

  const existingPid = readPid();
  if (existingPid && isProcessAlive(existingPid)) {
    const probe = await probeServer();
    if (!probe.admin.ok) {
      console.error(`serverのPID ${existingPid} は動作中ですが、localhost serverに接続できません。npm run restart を試してください。`);
      return 1;
    }
    if (announce) {
      console.log(`serverはすでに起動しています (PID ${existingPid})。`);
      printProbe(probe);
    }
    return 0;
  }
  if (existingPid) removePid();

  mkdirSync(RUNTIME_DIR, { recursive: true });
  let logFd;
  try {
    logFd = openSync(LOG_PATH, "a");
    const child = spawn(process.execPath, ["--env-file", CONFIG_PATH, SERVER_ENTRY], {
      cwd: ROOT,
      detached: true,
      env: runtimeEnv(readConfig()),
      stdio: ["ignore", logFd, logFd],
    });
    closeSync(logFd);
    logFd = undefined;
    if (!child.pid) throw new Error("server process did not return a PID");
    writeFileSync(PID_PATH, `${child.pid}\n`, { mode: 0o600 });
    chmodSync(PID_PATH, 0o600);

    if (!(await waitForServer(child.pid))) {
      if (isProcessAlive(child.pid)) process.kill(child.pid, "SIGTERM");
      removePid();
      console.error("localhost serverを起動できませんでした。server.logの末尾:");
      console.error(logTail());
      return 1;
    }
    child.unref();
    if (announce) {
      const probe = await probeServer();
      console.log(`localhost serverを起動しました (PID ${child.pid})。`);
      printProbe(probe);
    }
    return 0;
  } catch (error) {
    if (logFd !== undefined) closeSync(logFd);
    removePid();
    console.error(`localhost serverの起動に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function stopServer({ announce = true } = {}) {
  if (!nodeIsSupported()) return 1;
  const pid = readPid();
  if (!pid) {
    if (existsSync(PID_PATH)) removePid();
    if (announce) console.log("管理対象のlocalhost serverは停止しています。DBは変更していません。");
    return 0;
  }
  if (!isProcessAlive(pid)) {
    removePid();
    if (announce) console.log("serverはすでに停止していました。DBは変更していません。");
    return 0;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    console.error(`server (PID ${pid}) を停止できませんでした: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await delay(250);
    if (!isProcessAlive(pid)) {
      removePid();
      if (announce) console.log("localhost serverを停止しました。DBは変更していません。");
      return 0;
    }
  }
  console.error(`server (PID ${pid}) が停止しませんでした。server.logを確認してください。DBは変更していません。`);
  return 1;
}

async function statusServer() {
  if (!nodeIsSupported()) return 1;
  const config = readConfig();
  const pid = readPid();
  const running = pid ? isProcessAlive(pid) : false;
  if (pid && !running) removePid();
  const probe = await probeServer();
  console.log(`設定: ${config ? "済み" : "未設定 (npm run setup)"}`);
  console.log(`管理対象プロセス: ${running ? `起動中 (PID ${pid})` : "停止中"}`);
  printProbe(probe);
  return probe.admin.ok && probe.extension.ok ? 0 : 1;
}

async function setup() {
  if (!nodeIsSupported() || !bundleIsReady()) return 1;
  if (!installRuntimeDependencies()) return 1;

  const currentId = extensionIdFromConfig(readConfig());
  const readline = createInterface({ input: stdin, output: stdout });
  let answer;
  try {
    answer = await readline.question(
      `Chromeのextension ID (32文字の小文字 a-p)${currentId ? ` [${currentId}]` : ""}: `,
    );
  } finally {
    readline.close();
  }
  const id = (answer.trim() || currentId).replace(/^chrome-extension:\/\//, "");
  if (!isValidExtensionId(id)) {
    console.error("extension IDが正しくありません。chrome://extensionsのID欄にある32文字を入力してください。");
    return 1;
  }

  saveExtensionId(id);
  console.log("extensionの許可オリジンを .adp/config.env に保存しました（秘密情報ではありません）。");
  const existingPid = readPid();
  if (existingPid && isProcessAlive(existingPid)) {
    const stopCode = await stopServer({ announce: false });
    if (stopCode !== 0) return stopCode;
  }
  const startCode = await startServer({ announce: false });
  if (startCode !== 0) return startCode;

  const probe = await probeServer();
  console.log("初回設定の接続確認:");
  printProbe(probe);
  if (!probe.admin.ok) {
    console.error("管理画面に接続できません。 .adp/server.logのエラー、Node.js 22.x、41321番ポートを確認してください。");
  }
  if (!probe.extension.ok) {
    console.error("拡張機能に接続できません。chrome://extensionsで現在のIDを確認し、npm run setupを再実行してください。");
  }
  if (!probe.admin.ok || !probe.extension.ok) return 1;
  console.log(`設定完了。ブラウザで ${probe.baseUrl}/ を開き、拡張機能のポップアップも確認してください。`);
  console.log("次回から: npm start / npm run stop / npm run restart / npm run status");
  return 0;
}

function usage() {
  console.log("使い方: npm run setup | npm start | npm run stop | npm run restart | npm run status");
}

async function main() {
  const command = process.argv[2];
  if (command === "setup") return setup();
  if (command === "start") return startServer();
  if (command === "stop") return stopServer();
  if (command === "restart") {
    const stopCode = await stopServer();
    return stopCode === 0 ? startServer() : stopCode;
  }
  if (command === "status") return statusServer();
  usage();
  return 2;
}

const entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (entry === resolve(fileURLToPath(import.meta.url))) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
