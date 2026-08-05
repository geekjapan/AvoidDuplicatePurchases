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
  const window = new Window({ url: "http://127.0.0.1:41321/settings" });
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

describe("settings page", () => {
  let window: Window | undefined;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    defineGlobal("fetch", originalFetch);
    window?.close();
    window = undefined;
  });

  it("loads and saves port/exportDestination with live status", async () => {
    window = installDom();
    let savedBody: unknown;
    defineGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.endsWith("/api/settings")) {
        return new Response(JSON.stringify({ port: 41321, exportDestination: "" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (method === "POST" && url.endsWith("/api/settings")) {
        savedBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            port: 42000,
            exportDestination: "/tmp/adp-export",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    const { renderSettings } = await import("./settings.js");
    const root = document.getElementById("app")!;
    await renderSettings(root);

    const port = document.querySelector('[data-testid="settings-port"]') as HTMLInputElement;
    const dest = document.querySelector(
      '[data-testid="settings-export-destination"]',
    ) as HTMLInputElement;
    const form = document.querySelector('[data-testid="settings-form"]') as HTMLFormElement;
    assert.ok(port && dest && form);

    port.value = "42000";
    dest.value = "/tmp/adp-export";
    form.dispatchEvent(
      new (globalThis as unknown as { Event: typeof Event }).Event("submit", {
        bubbles: true,
        cancelable: true,
      }),
    );

    await waitFor(() => savedBody !== undefined, "settings saved");
    assert.deepEqual(savedBody, { port: 42000, exportDestination: "/tmp/adp-export" });

    await waitFor(() => {
      const status = document.querySelector('[data-testid="settings-status"]') as HTMLElement | null;
      return status?.getAttribute("data-kind") === "success";
    }, "save success status");

    const status = document.querySelector('[data-testid="settings-status"]') as HTMLElement;
    assert.equal(status.getAttribute("data-kind"), "success");
    assert.equal(status.getAttribute("aria-live"), "polite");
  });
});
