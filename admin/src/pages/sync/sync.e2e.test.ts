/**
 * Synthetic E2E-style sync journey (happy-dom). Grep target: "sync".
 * Placed under approved page dir (admin/src/pages/sync/**) — not admin/test.
 * Fetch is mocked so admin tsc rootDir stays free of server imports.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Window } from "happy-dom";

function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

describe("admin sync e2e journey", () => {
  let window: Window;
  const originalFetch = globalThis.fetch;

  before(() => {
    window = new Window({ url: "http://127.0.0.1:41321/sync" });
    defineGlobal("window", window);
    defineGlobal("document", window.document);
    defineGlobal("HTMLElement", window.HTMLElement);
    defineGlobal("HTMLInputElement", window.HTMLInputElement);
    defineGlobal("HTMLButtonElement", window.HTMLButtonElement);
    defineGlobal("Node", window.Node);
    defineGlobal("history", window.history);
    defineGlobal("location", window.location);
    window.document.body.innerHTML = '<div id="app"></div>';

    defineGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/api/sync-state/")) {
        return new Response(
          JSON.stringify({ cursor: null, lastSyncedAt: null, latestOutcome: null }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });
  });

  after(() => {
    defineGlobal("fetch", originalFetch);
    window.close();
  });

  it("navigates to sync page and lists per-source status rows", async () => {
    const { renderSync } = await import("./sync.js");
    const root = window.document.getElementById("app");
    assert.ok(root instanceof window.HTMLElement);
    await renderSync(root as unknown as HTMLElement);
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
