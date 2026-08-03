import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { handleApi } from "./http.js";

export function startServer(): { close: () => void } {
  const config = loadConfig();
  mkdirSync(dirname(config.dbPath), { recursive: true });
  const appDb = openDatabase(config.dbPath);
  const db = appDb.sqlite;

  const server = createServer(async (req, res) => {
    try {
      const handled = await handleApi(req, res, { db, port: config.port });
      if (!handled) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
      }
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
