/**
 * E2E-style sync journey (happy-dom). Grep target: "sync".
 */
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { Window } from "happy-dom";
import { openDatabase } from "../../server/src/db.js";
import { handleApi } from "../../server/src/http.js";
import { handleStatic } from "../../server/src/static.js";
import { isAllowedOrigin } from "../../server/src/config.js";
import "../../server/src/routes/listings.js";
import "../../server/src/routes/candidates.js";
import "../../server/src/routes/work.js";
import "../../server/src/routes/settings.js";
import "../../server/src/routes/manual.js";
import type { DatabaseSync } from "node:sqlite";

function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

describe("admin sync e2e journey", () => {
  let server: Server;
  let port: number;
  let db: DatabaseSync;
  let window: Window;

  before(async () => {
    db = openDatabase(":memory:").sqlite;
    server = createServer(async (req, res) => {
      const origin = req.headers.origin;
      if (!isAllowedOrigin(origin, port, new Set())) {
        res.writeHead(403);
        res.end();
        return;
      }
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      const apiHandled = await handleApi(req, res, { db, port });
      if (apiHandled) return;
      if (handleStatic(req, res, url)) return;
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        port = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });

    window = new Window({ url: `http://127.0.0.1:${port}/sync` });
    defineGlobal("window", window);
    defineGlobal("document", window.document);
    defineGlobal("HTMLElement", window.HTMLElement);
    defineGlobal("HTMLInputElement", window.HTMLInputElement);
    defineGlobal("HTMLButtonElement", window.HTMLButtonElement);
    defineGlobal("Node", window.Node);
    defineGlobal("fetch", window.fetch.bind(window));
    defineGlobal("history", window.history);
    defineGlobal("location", window.location);
    window.document.body.innerHTML = '<div id="app"></div>';
  });

  after(() => {
    window.close();
    server.close();
    db.close();
  });

  it("navigates to sync page and lists per-source status rows", async () => {
    const { renderSync } = await import("../src/pages/sync/sync.js");
    const root = window.document.getElementById("app")!;
    await renderSync(root);
    const rows = window.document.querySelectorAll('[data-testid^="sync-row-"]');
    assert.ok(rows.length >= 6, "expected all v1 sources plus full_sync rows");
    assert.ok(
      window.document.querySelector('[data-testid="rematch-btn"]'),
      "rematch button present",
    );
    assert.ok(
      window.document.querySelector('[data-testid="manual-form"]'),
      "manual form present",
    );
  });
});
