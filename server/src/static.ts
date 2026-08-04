import { createServer } from "node:http";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { isAllowedOrigin, loadConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { handleApi } from "./http.js";
import "./routes/listings.js";
import "./routes/candidates.js";
import "./routes/work.js";

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

/** Start API + admin SPA server (T-ADMIN-CORE entry). */
export function startServer(): { close: () => void } {
  const config = loadConfig();
  mkdirSync(dirname(config.dbPath), { recursive: true });
  const appDb = openDatabase(config.dbPath);
  const db = appDb.sqlite;

  const server = createServer(async (req, res) => {
    try {
      // Shared Origin gate for API and static SPA (spec §7).
      // No Origin header remains allowed (curl / same-machine tools).
      if (!isAllowedOrigin(req.headers.origin, config.port, config.extensionOrigins)) {
        forbidden(res);
        return;
      }

      const url = new URL(req.url ?? "/", `http://127.0.0.1:${config.port}`);
      const apiHandled = await handleApi(req, res, {
        db,
        port: config.port,
        extensionOrigins: config.extensionOrigins,
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

  server.listen(config.port, config.host);
  return {
    close: () => {
      server.close();
      appDb.close();
    },
  };
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  startServer();
}
