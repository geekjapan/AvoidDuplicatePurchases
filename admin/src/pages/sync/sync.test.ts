/**
 * Sync page DOM tests: stable never/error display and rematch/manual controls.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Window } from "happy-dom";

function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

function installDom(): Window {
  const window = new Window({ url: "http://127.0.0.1:41321/sync" });
  defineGlobal("window", window);
  defineGlobal("document", window.document);
  defineGlobal("HTMLElement", window.HTMLElement);
  defineGlobal("HTMLInputElement", window.HTMLInputElement);
  defineGlobal("HTMLButtonElement", window.HTMLButtonElement);
  defineGlobal("Node", window.Node);
  defineGlobal("fetch", window.fetch.bind(window));
  window.document.body.innerHTML = '<div id="app"></div>';
  return window;
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("sync page", () => {
  let window: Window | undefined;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    defineGlobal("fetch", originalFetch);
    window?.close();
    window = undefined;
  });

  it("renders never-synced and error rows stably", async () => {
    window = installDom();
    defineGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/api/sync-state/dlsite")) {
        return new Response(
          JSON.stringify({
            cursor: null,
            lastSyncedAt: "2026-03-01T00:00:00.000Z",
            latestOutcome: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (method === "GET" && url.includes("/api/sync-state/fanza_doujin")) {
        return new Response(
          JSON.stringify({
            cursor: null,
            lastSyncedAt: "2026-03-01T00:00:00.000Z",
            latestOutcome: {
              ok: false,
              counts: { inserted: 1, updated: 0 },
              error: "synthetic_failure",
              fetched: 2,
              recordedAt: "2026-03-01T00:00:00.000Z",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (method === "GET" && url.includes("/api/sync-state/")) {
        return new Response(
          JSON.stringify({ cursor: null, lastSyncedAt: null, latestOutcome: null }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    const { renderSync } = await import("./sync.js");
    const root = document.getElementById("app")!;
    await renderSync(root);

    await waitFor(
      () => document.querySelector('[data-testid="sync-row-dlsite"]') !== null,
      "dlsite row",
    );
    const dlsite = document.querySelector('[data-testid="sync-row-dlsite"]');
    const doujin = document.querySelector('[data-testid="sync-row-fanza_doujin"]');
    assert.match(dlsite?.textContent ?? "", /DLsite: 最終/);
    assert.match(doujin?.textContent ?? "", /エラー synthetic_failure/);

    const status = document.querySelector('[data-testid="sync-status-region"]') as HTMLElement;
    assert.equal(status.getAttribute("role"), "status");
    assert.equal(status.getAttribute("aria-live"), "polite");
  });

  it("shows per-source fetch errors and marks overall partial/error (not 未同期)", async () => {
    window = installDom();
    defineGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/api/sync-state/dlsite")) {
        return new Response(
          JSON.stringify({
            cursor: null,
            lastSyncedAt: "2026-03-01T00:00:00.000Z",
            latestOutcome: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (method === "GET" && url.includes("/api/sync-state/fanza_doujin")) {
        return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
      }
      if (method === "GET" && url.includes("/api/sync-state/")) {
        return new Response(
          JSON.stringify({ cursor: null, lastSyncedAt: null, latestOutcome: null }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    const { renderSync } = await import("./sync.js");
    const root = document.getElementById("app")!;
    await renderSync(root);

    await waitFor(
      () => document.querySelector('[data-testid="sync-row-fanza_doujin"]') !== null,
      "doujin row",
    );
    const doujin = document.querySelector('[data-testid="sync-row-fanza_doujin"]');
    assert.equal(doujin?.getAttribute("data-load"), "error");
    assert.match(doujin?.textContent ?? "", /取得エラー/);
    assert.doesNotMatch(doujin?.textContent ?? "", /未同期/);

    const dlsite = document.querySelector('[data-testid="sync-row-dlsite"]');
    assert.equal(dlsite?.getAttribute("data-load"), "ok");

    const status = document.querySelector('[data-testid="sync-status-region"]') as HTMLElement;
    await waitFor(
      () => status.getAttribute("data-kind") === "partial",
      "partial overall status",
    );
    assert.equal(status.getAttribute("data-kind"), "partial");
    assert.match(status.textContent ?? "", /一部/);
    assert.equal(status.getAttribute("role"), "alert");
  });
});
