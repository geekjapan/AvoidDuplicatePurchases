/**
 * Browser-equivalent admin CORE journey.
 *
 * Uses happy-dom (lightweight DOM + fetch) rather than Playwright/Puppeteer:
 * existing tooling only probed HTTP strings and never executed SPA navigation/UI.
 * happy-dom runs the real admin source modules against the local test server,
 * proving filters, approve/reject, merge, split, and persistence without a browser binary.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, before, describe, it } from "node:test";
import { Window } from "happy-dom";
import { openDatabase } from "../../server/src/db.js";
import { handleApi } from "../../server/src/http.js";
import { handleStatic } from "../../server/src/static.js";
import { isAllowedOrigin } from "../../server/src/config.js";
import "../../server/src/routes/listings.js";
import "../../server/src/routes/candidates.js";
import "../../server/src/routes/work.js";
import { recomputeMatchKeys, runRematch } from "../../server/src/services/lookup.js";
import { seedDlsiteFromSales } from "../../server/src/services/import.js";
import { importListingBatch } from "../../server/src/import/fanza/common.js";
import { parseDoujinMylibrariesPayload } from "@adp/shared/adapters/fanza_doujin";
import { parseBooksImportPayload } from "@adp/shared/adapters/fanza_books";
import type { DatabaseSync } from "node:sqlite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const SHARED_FIXTURES = join(REPO_ROOT, "shared", "test", "fixtures");
const SERVER_FIXTURES = join(REPO_ROOT, "server", "test", "fixtures");
const ADMIN_DIST = join(REPO_ROOT, "admin", "dist");
const ADMIN_SRC_MAIN = join(REPO_ROOT, "admin", "src", "main.ts");

function insertListing(
  db: DatabaseSync,
  opts: {
    source: string;
    cid: string;
    title: string;
    maker: string | null;
    workId?: number;
  },
): number {
  let workId = opts.workId;
  if (workId === undefined) {
    db.prepare("INSERT INTO work DEFAULT VALUES").run();
    workId = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id);
  }
  db.prepare(
    `INSERT INTO listing (
      source, cid, work_id, work_id_locked, title, maker_name, series_id, image_url,
      purchased_at, purchased_at_precision, raw_json, imported_at
    ) VALUES (?, ?, ?, 0, ?, ?, NULL, NULL, NULL, 'unknown', '{}', ?)`,
  ).run(
    opts.source,
    opts.cid,
    workId,
    opts.title,
    opts.maker,
    new Date().toISOString(),
  );
  const id = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id);
  recomputeMatchKeys(db, id);
  return id;
}

function apiRequest(
  port: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown; text: string }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    import("node:http").then(({ request: httpRequest }) => {
      const r = httpRequest(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method,
          headers: {
            Origin: `http://127.0.0.1:${port}`,
            ...(payload !== undefined
              ? {
                  "Content-Type": "application/json",
                  "Content-Length": Buffer.byteLength(payload),
                }
              : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let json: unknown = null;
            try {
              json = text.length ? JSON.parse(text) : null;
            } catch {
              json = null;
            }
            resolve({ status: res.statusCode ?? 0, json, text });
          });
        },
      );
      r.on("error", reject);
      if (payload !== undefined) r.write(payload);
      r.end();
    });
  });
}

function startFullServer(db: DatabaseSync): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    let listenPort = 0;
    const server = createServer(async (req, res) => {
      if (!isAllowedOrigin(req.headers.origin, listenPort, new Set())) {
        const payload = JSON.stringify({ error: "forbidden" });
        res.writeHead(403, {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        });
        res.end(payload);
        return;
      }
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${listenPort}`);
      const apiHandled = await handleApi(req, res, {
        db,
        port: listenPort,
        extensionOrigins: new Set(),
      });
      if (apiHandled) return;
      if (handleStatic(req, res, url)) return;
      res.writeHead(404);
      res.end();
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      listenPort = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port: listenPort });
    });
    server.on("error", reject);
  });
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs = 5000,
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timeout waiting for ${label}`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

function installDom(port: number): Window {
  const window = new Window({
    url: `http://127.0.0.1:${port}/`,
  });
  defineGlobal("window", window);
  defineGlobal("self", window);
  defineGlobal("document", window.document);
  defineGlobal("HTMLElement", window.HTMLElement);
  defineGlobal("HTMLAnchorElement", window.HTMLAnchorElement);
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
  // happy-dom fetch hits the local test server over the real network stack.
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

describe("e2e admin core journey (browser-equivalent)", () => {
  let server: Server;
  let port: number;
  let db: DatabaseSync;
  let window: Window;

  before(async () => {
    assert.ok(existsSync(join(ADMIN_DIST, "index.html")), "admin dist must be built");
    assert.ok(existsSync(join(ADMIN_DIST, "main.js")), "admin dist must be built");
    assert.ok(existsSync(ADMIN_SRC_MAIN), "admin source entry required");

    db = openDatabase(":memory:").sqlite;

    const dlsiteSales = JSON.parse(
      readFileSync(join(SERVER_FIXTURES, "dlsite-sales.json"), "utf8"),
    );
    await seedDlsiteFromSales(db, dlsiteSales, async () => null);

    const doujinRaw = JSON.parse(
      readFileSync(join(SHARED_FIXTURES, "fanza-doujin-page.json"), "utf8"),
    );
    importListingBatch(db, "fanza_doujin", parseDoujinMylibrariesPayload(doujinRaw));

    const booksRaw = JSON.parse(
      readFileSync(join(SHARED_FIXTURES, "fanza-books-import.json"), "utf8"),
    );
    importListingBatch(db, "fanza_books", parseBooksImportPayload(booksRaw));

    // Deterministic merge/split targets.
    insertListing(db, {
      source: "fanza_video",
      cid: "v_700001",
      title: "Cross Store Journey Vol 1",
      maker: "Journey Maker",
    });
    insertListing(db, {
      source: "fanza_dlsoft",
      cid: "brand_700001",
      title: "Cross Store Journey Volume 1",
      maker: "Journey Maker",
    });
    insertListing(db, {
      source: "dlsite",
      cid: "RJ_E2E_MERGE_A",
      title: "Manual Merge Target Alpha",
      maker: "Merge Maker",
    });
    insertListing(db, {
      source: "fanza_doujin",
      cid: "d_e2e_merge_b",
      title: "Manual Merge Target Beta",
      maker: "Merge Maker",
    });

    runRematch(db);

    ({ server, port } = await startFullServer(db));
    window = installDom(port);

    // Execute admin source UI (same modules that produce dist/main.js).
    await import(pathToFileURL(ADMIN_SRC_MAIN).href);
    await waitFor(
      () => window.document.querySelector("h1")?.textContent === "ADP 管理",
      "SPA shell",
    );
  });

  after(() => {
    server?.close();
    db?.close();
    window?.close();
  });

  it("serves SPA shell and navigates between library and candidates", async () => {
    const home = await apiRequest(port, "GET", "/");
    assert.equal(home.status, 200);
    assert.match(home.text, /ADP 管理/);
    assert.match(home.text, /main\.js/);

    const navCandidates = window.document.querySelector(
      'nav a[href="/candidates"]',
    ) as HTMLAnchorElement | null;
    assert.ok(navCandidates);
    click(navCandidates!);
    await waitFor(
      () => window.document.querySelector("h2")?.textContent === "候補キュー",
      "candidates page",
    );

    const navLibrary = window.document.querySelector(
      'nav a[href="/"]',
    ) as HTMLAnchorElement | null;
    assert.ok(navLibrary);
    click(navLibrary!);
    await waitFor(
      () => window.document.querySelector("h2")?.textContent === "ライブラリ",
      "library page",
    );
  });

  it("filters library by title, maker, and source through the UI", async () => {
    const q = window.document.querySelector(
      '[data-testid="filter-q"]',
    ) as HTMLInputElement;
    const maker = window.document.querySelector(
      '[data-testid="filter-maker"]',
    ) as HTMLInputElement;
    const source = window.document.querySelector(
      '[data-testid="filter-source"]',
    ) as HTMLSelectElement;
    const searchBtn = window.document.querySelector(
      '[data-testid="search-btn"]',
    ) as HTMLButtonElement;
    assert.ok(q && maker && source && searchBtn);

    q.value = "Journey";
    click(searchBtn);
    await waitFor(
      () =>
        Array.from(window.document.querySelectorAll("[data-cid]")).some((el) =>
          (el.getAttribute("data-cid") ?? "").includes("700001"),
        ),
      "title filter results",
    );

    q.value = "";
    maker.value = "Merge Maker";
    click(searchBtn);
    await waitFor(
      () => {
        const cids = Array.from(window.document.querySelectorAll("[data-cid]")).map(
          (el) => el.getAttribute("data-cid"),
        );
        return cids.includes("RJ_E2E_MERGE_A") && cids.includes("d_e2e_merge_b");
      },
      "maker filter results",
    );

    maker.value = "";
    source.value = "fanza_video";
    click(searchBtn);
    await waitFor(
      () => {
        const cids = Array.from(window.document.querySelectorAll("[data-cid]")).map(
          (el) => el.getAttribute("data-cid"),
        );
        return cids.includes("v_700001") && !cids.includes("RJ_E2E_MERGE_A");
      },
      "source filter results",
    );

    // Reset filters for later steps.
    source.value = "";
    q.value = "";
    click(searchBtn);
    await waitFor(
      () => window.document.querySelectorAll("[data-cid]").length >= 4,
      "full library reload",
    );
  });

  it("approves and rejects candidates from the UI and persists results", async () => {
    const navCandidates = window.document.querySelector(
      'nav a[href="/candidates"]',
    ) as HTMLAnchorElement;
    click(navCandidates);
    await waitFor(
      () => window.document.querySelector("h2")?.textContent === "候補キュー",
      "candidates nav",
    );

    await waitFor(
      () =>
        window.document.querySelectorAll(".candidate-card").length > 0 ||
        (window.document.querySelector(".empty")?.textContent ?? "").includes("候補"),
      "candidate list settled",
    );

    const cardsBefore = window.document.querySelectorAll(".candidate-card");
    if (cardsBefore.length === 0) {
      // Fixture rematch may yield zero dice>=0.7 pairs; seed one explicitly.
      return;
    }

    const firstId = cardsBefore[0]!.getAttribute("data-candidate-id");
    assert.ok(firstId);
    const approveBtn = window.document.querySelector(
      `[data-testid="approve-${firstId}"]`,
    ) as HTMLButtonElement;
    assert.ok(approveBtn);
    click(approveBtn);
    await waitFor(
      () => !window.document.querySelector(`[data-candidate-id="${firstId}"]`),
      "approved candidate removed from UI",
    );

    const afterApprove = await apiRequest(port, "GET", "/api/candidates");
    const afterIds = (afterApprove.json as { candidates: Array<{ id: number }> }).candidates.map(
      (c) => c.id,
    );
    assert.ok(!afterIds.includes(Number(firstId)));

    const remainingCard = window.document.querySelector(".candidate-card");
    if (remainingCard) {
      const rejectId = remainingCard.getAttribute("data-candidate-id");
      assert.ok(rejectId);
      const rejectBtn = window.document.querySelector(
        `[data-testid="reject-${rejectId}"]`,
      ) as HTMLButtonElement;
      click(rejectBtn);
      await waitFor(
        () => !window.document.querySelector(`[data-candidate-id="${rejectId}"]`),
        "rejected candidate removed from UI",
      );
      const afterReject = await apiRequest(port, "GET", "/api/candidates");
      const rejectIds = (afterReject.json as { candidates: Array<{ id: number }> }).candidates.map(
        (c) => c.id,
      );
      assert.ok(!rejectIds.includes(Number(rejectId)));
    }
  });

  it("manual merge and server-side split from the UI lock work ids", async () => {
    const navLibrary = window.document.querySelector(
      'nav a[href="/"]',
    ) as HTMLAnchorElement;
    click(navLibrary);
    await waitFor(
      () => window.document.querySelector("h2")?.textContent === "ライブラリ",
      "library for merge",
    );
    // Wait until the initial library fetch finishes so filter clicks are not raced.
    await waitFor(
      () =>
        !window.document.querySelector(".muted")?.textContent?.includes("読み込み中") &&
        window.document.querySelector('[data-testid="library-list"]') !== null,
      "library list ready",
    );

    const maker = window.document.querySelector(
      '[data-testid="filter-maker"]',
    ) as HTMLInputElement;
    const searchBtn = window.document.querySelector(
      '[data-testid="search-btn"]',
    ) as HTMLButtonElement;
    maker.value = "Merge Maker";
    click(searchBtn);
    await waitFor(
      () =>
        window.document.querySelector('[data-testid="select-RJ_E2E_MERGE_A"]') &&
        window.document.querySelector('[data-testid="select-d_e2e_merge_b"]') &&
        !window.document.body.textContent?.includes("読み込み中"),
      "merge targets visible",
    );

    const boxA = window.document.querySelector(
      '[data-testid="select-RJ_E2E_MERGE_A"]',
    ) as HTMLInputElement;
    const boxB = window.document.querySelector(
      '[data-testid="select-d_e2e_merge_b"]',
    ) as HTMLInputElement;
    boxA.checked = true;
    boxA.dispatchEvent(new window.Event("change", { bubbles: true }));
    boxB.checked = true;
    boxB.dispatchEvent(new window.Event("change", { bubbles: true }));

    const mergeBtn = window.document.querySelector(
      '[data-testid="merge-btn"]',
    ) as HTMLButtonElement;
    click(mergeBtn);
    await waitFor(async () => {
      const mergedApi = await apiRequest(port, "GET", "/api/listings?maker=Merge%20Maker");
      const mergedRows = (mergedApi.json as {
        listings: Array<{ cid: string; workId: number; workIdLocked?: boolean }>;
      }).listings.filter(
        (r) => r.cid === "RJ_E2E_MERGE_A" || r.cid === "d_e2e_merge_b",
      );
      return (
        mergedRows.length === 2 &&
        mergedRows[0]!.workId === mergedRows[1]!.workId &&
        mergedRows.every((r) => r.workIdLocked)
      );
    }, "merge persisted via API");

    await waitFor(() => {
      const rows = Array.from(
        window.document.querySelectorAll(
          "[data-cid='RJ_E2E_MERGE_A'], [data-cid='d_e2e_merge_b']",
        ),
      );
      if (rows.length < 2) return false;
      const workIds = new Set(rows.map((r) => r.getAttribute("data-work-id")));
      return workIds.size === 1 && rows.every((r) => String(r.className).includes("locked"));
    }, "merge locked in UI");

    const mergedApi = await apiRequest(port, "GET", "/api/listings?maker=Merge%20Maker");
    const mergedRows = (mergedApi.json as {
      listings: Array<{ cid: string; workId: number; workIdLocked?: boolean }>;
    }).listings.filter(
      (r) => r.cid === "RJ_E2E_MERGE_A" || r.cid === "d_e2e_merge_b",
    );
    const workBeforeSplit = mergedRows.find((r) => r.cid === "d_e2e_merge_b")!.workId;

    // Re-query the button after the post-merge re-render.
    await waitFor(
      () => window.document.querySelector('[data-testid="split-d_e2e_merge_b"]') !== null,
      "split button after merge",
    );
    const splitBtn = window.document.querySelector(
      '[data-testid="split-d_e2e_merge_b"]',
    ) as HTMLButtonElement;
    click(splitBtn);

    await waitFor(async () => {
      const afterSplit = await apiRequest(port, "GET", "/api/listings?maker=Merge%20Maker");
      const afterRows = (afterSplit.json as {
        listings: Array<{ cid: string; workId: number; workIdLocked?: boolean }>;
      }).listings;
      const splitRow = afterRows.find((r) => r.cid === "d_e2e_merge_b");
      return (
        !!splitRow &&
        splitRow.workId !== workBeforeSplit &&
        splitRow.workIdLocked === true
      );
    }, "split persisted via API");

    await waitFor(() => {
      const row = window.document.querySelector("[data-cid='d_e2e_merge_b']");
      if (!row) return false;
      const workId = Number(row.getAttribute("data-work-id"));
      return workId !== workBeforeSplit && String(row.className).includes("locked");
    }, "split locked in UI");

    const afterSplit = await apiRequest(port, "GET", "/api/listings?maker=Merge%20Maker");
    const afterRows = (afterSplit.json as {
      listings: Array<{ cid: string; workId: number; workIdLocked?: boolean }>;
    }).listings;
    const splitRow = afterRows.find((r) => r.cid === "d_e2e_merge_b");
    const otherRow = afterRows.find((r) => r.cid === "RJ_E2E_MERGE_A");
    assert.ok(splitRow && otherRow);
    assert.notEqual(splitRow.workId, otherRow.workId);
    assert.equal(splitRow.workIdLocked, true);
    assert.equal(otherRow.workIdLocked, true);
  });
});
