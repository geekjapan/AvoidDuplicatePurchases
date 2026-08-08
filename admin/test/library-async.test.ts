/**
 * Controlled-fetch DOM tests for library initial-load async discipline
 * (STD-ADMIN-ASYNC-1): pending/disable, no overlapping GET, stale generation
 * ignored, initial error visible via aria-live, controls recover.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Window } from "happy-dom";

type ListingPayload = {
  listings: Array<{
    id: number;
    source: string;
    cid: string;
    workId: number;
    workIdLocked?: boolean;
    title: string;
    maker: string | null;
    seriesId: string | null;
    imageUrl: string | null;
    imageProvenance: string | null;
    productUrl: string | null;
    productUrlProvenance: string | null;
    purchasedAt: string | null;
    purchasedAtPrecision: "second" | "day" | "unknown";
    purchasePrice: null;
    currentPrice: null;
  }>;
  total: number;
};

const SAMPLE: ListingPayload = {
  listings: [
    {
      id: 1,
      source: "dlsite",
      cid: "RJ_ASYNC_1",
      workId: 10,
      workIdLocked: false,
      title: "Async Sample One",
      maker: "Async Maker",
      seriesId: null,
      imageUrl: null,
      imageProvenance: null,
      productUrl: null,
      productUrlProvenance: null,
      purchasedAt: null,
      purchasedAtPrecision: "unknown",
      purchasePrice: null,
      currentPrice: null,
    },
    {
      id: 2,
      source: "fanza_doujin",
      cid: "d_async_2",
      workId: 11,
      workIdLocked: false,
      title: "Async Sample Two",
      maker: "Async Maker",
      seriesId: null,
      imageUrl: null,
      imageProvenance: null,
      productUrl: null,
      productUrlProvenance: null,
      purchasedAt: null,
      purchasedAtPrecision: "unknown",
      purchasePrice: null,
      currentPrice: null,
    },
  ],
  total: 2,
};

function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

function installDom(): Window {
  const window = new Window({ url: "http://127.0.0.1:41321/" });
  defineGlobal("window", window);
  defineGlobal("self", window);
  defineGlobal("document", window.document);
  defineGlobal("HTMLElement", window.HTMLElement);
  defineGlobal("HTMLInputElement", window.HTMLInputElement);
  defineGlobal("HTMLButtonElement", window.HTMLButtonElement);
  defineGlobal("HTMLSelectElement", window.HTMLSelectElement);
  defineGlobal("Node", window.Node);
  defineGlobal("Event", window.Event);
  defineGlobal("MouseEvent", window.MouseEvent);
  defineGlobal("CustomEvent", window.CustomEvent);
  defineGlobal("location", window.location);
  defineGlobal("history", window.history);
  defineGlobal("navigator", window.navigator);
  defineGlobal("fetch", window.fetch.bind(window));
  window.document.body.innerHTML = '<div id="app"></div>';
  return window;
}

function click(el: Element): void {
  el.dispatchEvent(
    new (globalThis as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    }),
  );
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timeout waiting for ${label}`);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

function controls(): {
  search: HTMLButtonElement;
  q: HTMLInputElement;
  source: HTMLSelectElement;
  maker: HTMLInputElement;
  status: HTMLElement;
  list: HTMLElement;
} {
  const search = document.querySelector('[data-testid="search-btn"]') as HTMLButtonElement;
  const q = document.querySelector('[data-testid="filter-q"]') as HTMLInputElement;
  const source = document.querySelector('[data-testid="filter-source"]') as HTMLSelectElement;
  const maker = document.querySelector('[data-testid="filter-maker"]') as HTMLInputElement;
  const status = document.querySelector('[data-testid="library-status"]') as HTMLElement;
  const list = document.querySelector('[data-testid="library-list"]') as HTMLElement;
  assert.ok(search && q && source && maker && status && list);
  return { search, q, source, maker, status, list };
}

function assertControlsDisabled(expected: boolean): void {
  const { search, q, source, maker } = controls();
  assert.equal(search.disabled, expected, `search disabled=${expected}`);
  assert.equal(q.disabled, expected, `q disabled=${expected}`);
  assert.equal(source.disabled, expected, `source disabled=${expected}`);
  assert.equal(maker.disabled, expected, `maker disabled=${expected}`);
}

describe("library initial load async discipline", () => {
  let window: Window | undefined;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    defineGlobal("fetch", originalFetch);
    window?.close();
    window = undefined;
  });

  it("holds initial request: controls disabled and click cannot issue second GET", async () => {
    window = installDom();
    let getCalls = 0;
    let release: (() => void) | null = null;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });

    defineGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/api/listings")) {
        getCalls += 1;
        await hold;
        return new Response(JSON.stringify(SAMPLE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    const { renderLibrary } = await import("../src/pages/library.js");
    const root = document.getElementById("app")!;
    const renderPromise = renderLibrary(root);

    await waitFor(() => getCalls === 1, "initial GET issued");
    await waitFor(() => {
      const search = document.querySelector(
        '[data-testid="search-btn"]',
      ) as HTMLButtonElement | null;
      return search?.disabled === true;
    }, "controls disabled during initial load");
    assertControlsDisabled(true);

    // Click while initial load is held must not start a second GET.
    const { search } = controls();
    click(search);
    click(search);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(getCalls, 1, "overlapping click must not issue second GET");

    release!();
    await renderPromise;
    await waitFor(
      () => document.querySelector('[data-testid="select-RJ_ASYNC_1"]') !== null,
      "listings rendered after release",
    );
    assertControlsDisabled(false);
    assert.equal(getCalls, 1);
  });

  it("ignores stale older response when overlapping programmatic loads occur", async () => {
    window = installDom();

    type Held = {
      resolve: (value: Response) => void;
      reject: (reason?: unknown) => void;
      url: string;
    };
    const held: Held[] = [];
    let getCalls = 0;

    defineGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/api/listings")) {
        getCalls += 1;
        return new Promise<Response>((resolve, reject) => {
          held.push({ resolve, reject, url });
        });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    const { renderLibrary } = await import("../src/pages/library.js");
    const root = document.getElementById("app")!;
    const renderPromise = renderLibrary(root);

    await waitFor(() => held.length === 1, "initial request held");
    assert.equal(getCalls, 1);

    // Programmatically kick a second load while first is still in flight
    // (search is disabled, so re-enable briefly to simulate programmatic overlap).
    const { search, maker } = controls();
    assert.equal(search.disabled, true);
    maker.disabled = false;
    search.disabled = false;
    maker.value = "Async Maker";
    click(search);

    await waitFor(() => held.length === 2, "second overlapping request held");
    assert.equal(getCalls, 2);

    // Resolve older request first with empty payload — must be ignored.
    const stalePayload: ListingPayload = { listings: [], total: 0 };
    held[0]!.resolve(
      new Response(JSON.stringify(stalePayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await new Promise((r) => setTimeout(r, 20));

    // Newer response carries the real listings.
    held[1]!.resolve(
      new Response(JSON.stringify(SAMPLE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await renderPromise;
    await waitFor(
      () => document.querySelector('[data-testid="select-RJ_ASYNC_1"]') !== null,
      "newer response wins",
    );
    // Stale empty payload must not have won.
    assert.ok(
      !document.querySelector(".empty")?.textContent?.includes("該当する listing がありません"),
      "stale empty response must not overwrite newer listings",
    );
    assertControlsDisabled(false);
  });

  it("shows initial failure in aria-live and recovers controls", async () => {
    window = installDom();
    let getCalls = 0;
    let failFirst = true;

    defineGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.includes("/api/listings")) {
        getCalls += 1;
        if (failFirst) {
          failFirst = false;
          return new Response(JSON.stringify({ error: "forced initial failure" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify(SAMPLE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });

    const { renderLibrary } = await import("../src/pages/library.js");
    const root = document.getElementById("app")!;
    await renderLibrary(root);

    const { status, search } = controls();
    assert.equal(status.getAttribute("data-kind"), "error");
    assert.equal(status.getAttribute("role"), "alert");
    assert.equal(status.getAttribute("aria-live"), "assertive");
    assert.match(status.textContent ?? "", /API 500|forced initial failure|error/i);
    assertControlsDisabled(false);
    assert.equal(getCalls, 1);

    // Recovery: a subsequent search succeeds and restores listings.
    click(search);
    await waitFor(
      () => document.querySelector('[data-testid="select-RJ_ASYNC_1"]') !== null,
      "recovery load renders listings",
    );
    assert.equal(getCalls, 2);
    assertControlsDisabled(false);
  });
});
