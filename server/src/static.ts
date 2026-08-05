import { createServer, type Server } from "node:http";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { dlsiteProductJsonUrl } from "@adp/shared/adapters/dlsite";
import { isAllowedOrigin, loadConfig, type ServerConfig } from "./config.js";
import { isReadonlyMode, openReadonlyDatabase } from "./config/readonly.js";
import { openDatabase } from "./db.js";
import { handleApi } from "./http.js";
import { withReadonlyGuard } from "./middleware/readonly-guard.js";
import { installAutoExport } from "./export/auto.js";
import type { ProductFetcher } from "./services/import.js";
import { loadAdminSettings } from "./routes/settings.js";
import "./routes/listings.js";
import "./routes/candidates.js";
import "./routes/work.js";
import "./routes/settings.js";
import "./routes/manual.js";
import "./export/route.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = join(__dirname, "..");
const ADMIN_DIST = join(SERVER_ROOT, "..", "admin", "dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function contentType(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function forbidden(res: import("node:http").ServerResponse): void {
  const payload = JSON.stringify({ error: "forbidden" });
  res.writeHead(403, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Serve built admin SPA assets; SPA paths fall back to index.html. */
export function handleStatic(
  _req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  url: URL,
): boolean {
  if (url.pathname.startsWith("/api/")) return false;

  const rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
  const safe = normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(ADMIN_DIST, safe);
  if (!filePath.startsWith(ADMIN_DIST)) {
    res.writeHead(403);
    res.end();
    return true;
  }

  if (existsSync(filePath) && extname(filePath) !== "") {
    const body = readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": contentType(filePath),
      "Content-Length": body.length,
    });
    res.end(body);
    return true;
  }

  const indexPath = join(ADMIN_DIST, "index.html");
  if (!existsSync(indexPath)) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("admin UI not built");
    return true;
  }

  const html = readFileSync(indexPath);
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": html.length,
  });
  res.end(html);
  return true;
}

/**
 * Production DLsite product.json fetcher for manual/import metadata enrichment.
 * Reuses the shared public product.json URL contract. Network / non-2xx / invalid
 * JSON never throw — callers fall back to cid-only registration.
 */
export function createProductionProductFetcher(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): ProductFetcher {
  return async (workno: string) => {
    try {
      const res = await fetchImpl(dlsiteProductJsonUrl(workno), {
        headers: { "User-Agent": "Mozilla/5.0 (ADP)" },
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };
}

export interface StartServerOptions {
  /** Env map for loadConfig (defaults to process.env). */
  env?: Record<string, string | undefined>;
  /** Injected fetch for product.json (defaults to global fetch). */
  fetchImpl?: typeof fetch;
  /**
   * When false, create the HTTP server but do not call listen.
   * Tests can still drive requests via the returned `server` when listen is true
   * on an ephemeral port, or use handleApi seams.
   */
  listen?: boolean;
  /** Override listen host (defaults to config.host). */
  host?: string;
  /**
   * Force listen port. When set, takes precedence over env and persisted settings.
   * Use 0 for an ephemeral port (listen required).
   */
  port?: number;
  /** Optional pre-built config (skips loadConfig when provided). */
  config?: ServerConfig;
}

export interface StartedServer {
  close: () => void;
  /** Actual listen port (resolved after ready when ephemeral 0 was requested). */
  readonly port: number;
  host: string;
  server: Server;
  /** Resolves once listen has bound (or immediately when listen:false). */
  ready: Promise<void>;
  /** True when productFetcher was installed on the production ApiContext path. */
  hasProductFetcher: boolean;
}

/**
 * Resolve listen port after DB open.
 * Priority (conservative, matches existing config contract):
 * 1. explicit options.port
 * 2. ADP_PORT when set in env (ops override / loadConfig)
 * 3. persisted admin settings port from DB
 * 4. loadConfig default port
 */
export function resolveListenPort(
  config: ServerConfig,
  db: import("node:sqlite").DatabaseSync,
  env: Record<string, string | undefined>,
  forcedPort?: number,
): number {
  if (forcedPort !== undefined) return forcedPort;
  if (env.ADP_PORT !== undefined && String(env.ADP_PORT).trim() !== "") {
    return config.port;
  }
  const settings = loadAdminSettings(db, config.port);
  return settings.port;
}

/** Start API + admin SPA server (T-ADMIN-CORE entry + T-ADMIN-OPS wiring). */
export function startServer(options: StartServerOptions = {}): StartedServer {
  const env = options.env ?? (process.env as Record<string, string | undefined>);
  const config = options.config ?? loadConfig(env);
  const readonly = isReadonlyMode(env);
  if (!readonly) mkdirSync(dirname(config.dbPath), { recursive: true });
  // Read-only mode opens the snapshot directly: no migrations, no writes.
  const appDb = readonly ? null : openDatabase(config.dbPath);
  const db = appDb ? appDb.sqlite : openReadonlyDatabase(config.dbPath);

  const runtime = {
    port: resolveListenPort(config, db, env, options.port),
  };
  const host = options.host ?? config.host;
  const productFetcher = createProductionProductFetcher(
    options.fetchImpl ?? globalThis.fetch.bind(globalThis),
  );
  const apiHandler = readonly ? withReadonlyGuard(handleApi) : handleApi;
  // Successful syncs auto-export on the main (writable) machine only.
  // Production instance holds the unsubscribe so close can detach exactly once
  // before the DB handle is closed (listener must not fire on a closed DB).
  const unsubscribeAutoExport = readonly
    ? null
    : installAutoExport(db, runtime.port);

  const server = createServer(async (req, res) => {
    try {
      // Shared Origin gate for API and static SPA (spec §7).
      // No Origin header remains allowed (curl / same-machine tools).
      // Port must match the actual listen/origin port (persisted or env).
      const port = runtime.port;
      if (!isAllowedOrigin(req.headers.origin, port, config.extensionOrigins)) {
        forbidden(res);
        return;
      }

      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      const apiHandled = await apiHandler(req, res, {
        db,
        port,
        extensionOrigins: config.extensionOrigins,
        productFetcher,
      });
      if (apiHandled) return;

      if (handleStatic(req, res, url)) return;

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
    } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "internal_error" }));
    }
  });

  const shouldListen = options.listen !== false;
  let resolveReady!: () => void;
  let rejectReady!: (err: Error) => void;
  let readySettled = false;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = () => {
      if (readySettled) return;
      readySettled = true;
      resolve();
    };
    rejectReady = (err: Error) => {
      if (readySettled) return;
      readySettled = true;
      reject(err);
    };
  });

  if (shouldListen) {
    server.once("error", (err) => {
      rejectReady(err instanceof Error ? err : new Error(String(err)));
    });
    server.listen(runtime.port, host, () => {
      if (runtime.port === 0) {
        const addr = server.address();
        runtime.port = typeof addr === "object" && addr ? addr.port : runtime.port;
      }
      resolveReady();
    });
  } else {
    resolveReady();
  }

  let closed = false;
  const close = (): void => {
    // Idempotent: concurrent / double close must unsubscribe and close DB once.
    if (closed) return;
    closed = true;
    // Detach auto-export before closing the DB so a late sync cannot call into it.
    unsubscribeAutoExport?.();
    server.close();
    try {
      db.close();
    } catch {
      // Already-closed or listen-failed handles must not break shutdown.
    }
  };

  return {
    close,
    get port() {
      return runtime.port;
    },
    host,
    server,
    ready,
    hasProductFetcher: true,
  };
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  startServer();
}
