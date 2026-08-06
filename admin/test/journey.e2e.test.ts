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

function insertCandidate(
  db: DatabaseSync,
  listingAId: number,
  listingBId: number,
  dice = 0.85,
): number {
  const a = Math.min(listingAId, listingBId);
  const b = Math.max(listingAId, listingBId);
  db.prepare(
    "INSERT INTO candidate (listing_a_id, listing_b_id, dice) VALUES (?, ?, ?)",
  ).run(a, b, dice);
  return Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id);
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

type ListingRow = {
  id: number;
  cid: string;
  workId: number;
  workIdLocked?: boolean;
};

describe("e2e admin core journey (browser-equivalent)", () => {
  let server: Server;
  let port: number;
  let db: DatabaseSync;
  let window: Window;
  let approveCandidateId: number;
  let rejectCandidateId: number;
  let approveListingIds: { a: number; b: number };
  let rejectListingIds: { a: number; b: number };

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

    // Distinct approve/reject listing pairs (candidates seeded after rematch —
    // runRematch wipes the candidate table).
    const approveA = insertListing(db, {
      source: "dlsite",
      cid: "RJ_E2E_APPROVE_A",
      title: "E2E Approve Pair Alpha",
      maker: "Approve Maker",
    });
    const approveB = insertListing(db, {
      source: "fanza_doujin",
      cid: "d_e2e_approve_b",
      title: "E2E Approve Pair Beta",
      maker: "Approve Maker",
    });
    approveListingIds = { a: approveA, b: approveB };

    const rejectA = insertListing(db, {
      source: "dlsite",
      cid: "RJ_E2E_REJECT_A",
      title: "E2E Reject Pair Alpha",
      maker: "Reject Maker",
    });
    const rejectB = insertListing(db, {
      source: "fanza_books",
      cid: "b_e2e_reject_b",
      title: "E2E Reject Pair Beta",
      maker: "Reject Maker",
    });
    rejectListingIds = { a: rejectA, b: rejectB };

    runRematch(db);

    // Wipe any rematch-produced edges on our pairs, then seed fixed candidates.
    db.prepare(
      `DELETE FROM candidate
       WHERE listing_a_id IN (?, ?, ?, ?) OR listing_b_id IN (?, ?, ?, ?)`,
    ).run(approveA, approveB, rejectA, rejectB, approveA, approveB, rejectA, rejectB);
    approveCandidateId = insertCandidate(db, approveA, approveB, 0.95);
    rejectCandidateId = insertCandidate(db, rejectA, rejectB, 0.92);
    assert.ok(approveCandidateId > 0);
    assert.ok(rejectCandidateId > 0);
    assert.notEqual(approveCandidateId, rejectCandidateId);

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

  it("exposes accessible filter labels, checkbox names, and live status regions", async () => {
    await waitFor(
      () => window.document.querySelector("h2")?.textContent === "ライブラリ",
      "library for a11y",
    );
    await waitFor(
      () =>
        !window.document.querySelector(".muted")?.textContent?.includes("読み込み中") &&
        window.document.querySelector('[data-testid="library-list"]') !== null,
      "library ready for a11y",
    );

    const qLabel = window.document.querySelector('label[for="filter-q"]');
    const sourceLabel = window.document.querySelector('label[for="filter-source"]');
    const makerLabel = window.document.querySelector('label[for="filter-maker"]');
    assert.ok(qLabel, "title search must have associated label");
    assert.ok(sourceLabel, "source select must have associated label");
    assert.ok(makerLabel, "maker input must have associated label");

    const q = window.document.querySelector("#filter-q") as HTMLInputElement | null;
    const source = window.document.querySelector("#filter-source") as HTMLSelectElement | null;
    const maker = window.document.querySelector("#filter-maker") as HTMLInputElement | null;
    assert.ok(q?.getAttribute("aria-label") || qLabel);
    assert.ok(source?.getAttribute("aria-label") || sourceLabel);
    assert.ok(maker?.getAttribute("aria-label") || makerLabel);

    const libraryStatus = window.document.querySelector('[data-testid="library-status"]');
    assert.ok(libraryStatus);
    assert.ok(
      libraryStatus!.getAttribute("aria-live") === "polite" ||
        libraryStatus!.getAttribute("aria-live") === "assertive",
    );

    const makerFilter = window.document.querySelector(
      '[data-testid="filter-maker"]',
    ) as HTMLInputElement;
    const searchBtn = window.document.querySelector(
      '[data-testid="search-btn"]',
    ) as HTMLButtonElement;
    makerFilter.value = "Merge Maker";
    click(searchBtn);
    await waitFor(
      () => window.document.querySelector('[data-testid="select-RJ_E2E_MERGE_A"]') !== null,
      "merge listing for checkbox a11y",
    );

    const checkbox = window.document.querySelector(
      '[data-testid="select-RJ_E2E_MERGE_A"]',
    ) as HTMLInputElement;
    const name = checkbox.getAttribute("aria-label") ?? "";
    assert.match(name, /RJ_E2E_MERGE_A/);
    assert.match(name, /Manual Merge Target Alpha|Merge/i);

    // Reset filters for later steps.
    makerFilter.value = "";
    click(searchBtn);
    await waitFor(
      () => window.document.querySelectorAll("[data-cid]").length >= 4,
      "library reset after a11y",
    );
  });

  it("gives each library split button a unique accessible name with title/source/cid (SPEC-ADMIN-A11Y-ACTION-CONTEXT-1)", async () => {
    await waitFor(
      () => window.document.querySelector("h2")?.textContent === "ライブラリ",
      "library for split a11y",
    );
    const makerFilter = window.document.querySelector(
      '[data-testid="filter-maker"]',
    ) as HTMLInputElement;
    const searchBtn = window.document.querySelector(
      '[data-testid="search-btn"]',
    ) as HTMLButtonElement;
    makerFilter.value = "Merge Maker";
    click(searchBtn);
    await waitFor(
      () =>
        window.document.querySelector('[data-testid="split-RJ_E2E_MERGE_A"]') !== null &&
        window.document.querySelector('[data-testid="split-d_e2e_merge_b"]') !== null,
      "two split buttons for a11y",
    );

    const splitA = window.document.querySelector(
      '[data-testid="split-RJ_E2E_MERGE_A"]',
    ) as HTMLButtonElement;
    const splitB = window.document.querySelector(
      '[data-testid="split-d_e2e_merge_b"]',
    ) as HTMLButtonElement;
    assert.equal(splitA.textContent?.trim(), "分離", "visible split label preserved");
    assert.equal(splitB.textContent?.trim(), "分離", "visible split label preserved");

    const nameA = splitA.getAttribute("aria-label") ?? "";
    const nameB = splitB.getAttribute("aria-label") ?? "";
    assert.match(nameA, /分離/);
    assert.match(nameA, /Manual Merge Target Alpha|Merge/i);
    assert.match(nameA, /dlsite/);
    assert.match(nameA, /RJ_E2E_MERGE_A/);
    assert.match(nameB, /分離/);
    assert.match(nameB, /Manual Merge Target Beta|Merge/i);
    assert.match(nameB, /fanza_doujin/);
    assert.match(nameB, /d_e2e_merge_b/);
    assert.notEqual(nameA, nameB, "each split button must uniquely identify its listing");
    assert.ok(!nameA.includes("d_e2e_merge_b"), "split A name must not include B cid");
    assert.ok(!nameB.includes("RJ_E2E_MERGE_A"), "split B name must not include A cid");

    makerFilter.value = "";
    click(searchBtn);
    await waitFor(
      () => window.document.querySelectorAll("[data-cid]").length >= 4,
      "library reset after split a11y",
    );
  });

  it("gives each candidate action button a unique accessible name with pair identity (SPEC-ADMIN-A11Y-ACTION-CONTEXT-1)", async () => {
    // Seed two distinct candidate cards so accessible names must disambiguate pairs.
    const a1 = insertListing(db, {
      source: "dlsite",
      cid: "RJ_E2E_A11Y_A1",
      title: "A11y Pair One Alpha",
      maker: "A11y Maker",
    });
    const b1 = insertListing(db, {
      source: "fanza_doujin",
      cid: "d_e2e_a11y_b1",
      title: "A11y Pair One Beta",
      maker: "A11y Maker",
    });
    const a2 = insertListing(db, {
      source: "dlsite",
      cid: "RJ_E2E_A11Y_A2",
      title: "A11y Pair Two Alpha",
      maker: "A11y Maker",
    });
    const b2 = insertListing(db, {
      source: "fanza_books",
      cid: "b_e2e_a11y_b2",
      title: "A11y Pair Two Beta",
      maker: "A11y Maker",
    });
    const cand1 = insertCandidate(db, a1, b1, 0.9);
    const cand2 = insertCandidate(db, a2, b2, 0.91);

    const navCandidates = window.document.querySelector(
      'nav a[href="/candidates"]',
    ) as HTMLAnchorElement;
    click(navCandidates);
    await waitFor(
      () =>
        window.document.querySelector(`[data-candidate-id="${cand1}"]`) !== null &&
        window.document.querySelector(`[data-candidate-id="${cand2}"]`) !== null,
      "two candidate cards for a11y",
    );

    const approve1 = window.document.querySelector(
      `[data-testid="approve-${cand1}"]`,
    ) as HTMLButtonElement;
    const reject1 = window.document.querySelector(
      `[data-testid="reject-${cand1}"]`,
    ) as HTMLButtonElement;
    const approve2 = window.document.querySelector(
      `[data-testid="approve-${cand2}"]`,
    ) as HTMLButtonElement;
    const reject2 = window.document.querySelector(
      `[data-testid="reject-${cand2}"]`,
    ) as HTMLButtonElement;
    assert.ok(approve1 && reject1 && approve2 && reject2);

    assert.equal(approve1.textContent?.trim(), "○ 同一");
    assert.equal(reject1.textContent?.trim(), "× 別物");

    const approveName1 = approve1.getAttribute("aria-label") ?? "";
    const rejectName1 = reject1.getAttribute("aria-label") ?? "";
    const approveName2 = approve2.getAttribute("aria-label") ?? "";
    const rejectName2 = reject2.getAttribute("aria-label") ?? "";

    for (const name of [approveName1, rejectName1]) {
      assert.match(name, /A11y Pair One Alpha/);
      assert.match(name, /RJ_E2E_A11Y_A1/);
      assert.match(name, /A11y Pair One Beta/);
      assert.match(name, /d_e2e_a11y_b1/);
      assert.match(name, /dlsite/);
      assert.match(name, /fanza_doujin/);
    }
    for (const name of [approveName2, rejectName2]) {
      assert.match(name, /A11y Pair Two Alpha/);
      assert.match(name, /RJ_E2E_A11Y_A2/);
      assert.match(name, /A11y Pair Two Beta/);
      assert.match(name, /b_e2e_a11y_b2/);
    }
    assert.match(approveName1, /○ 同一|同一/);
    assert.match(rejectName1, /× 別物|別物/);
    assert.notEqual(approveName1, approveName2, "approve names uniquely identify each pair");
    assert.notEqual(rejectName1, rejectName2, "reject names uniquely identify each pair");
    assert.ok(
      !approveName1.includes("RJ_E2E_A11Y_A2"),
      "card1 approve must not include card2 cid",
    );
    assert.ok(
      !approveName2.includes("RJ_E2E_A11Y_A1"),
      "card2 approve must not include card1 cid",
    );

    // Leave candidates page for later journey steps that expect library.
    const navLibrary = window.document.querySelector(
      'nav a[href="/"]',
    ) as HTMLAnchorElement;
    click(navLibrary);
    await waitFor(
      () => window.document.querySelector("h2")?.textContent === "ライブラリ",
      "library after candidate a11y",
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

  it("approves and rejects distinct candidates from the UI and persists results", async () => {
    const navCandidates = window.document.querySelector(
      'nav a[href="/candidates"]',
    ) as HTMLAnchorElement;
    click(navCandidates);
    await waitFor(
      () => window.document.querySelector("h2")?.textContent === "候補キュー",
      "candidates nav",
    );

    await waitFor(
      () => window.document.querySelectorAll(".candidate-card").length >= 2,
      "at least two deterministic candidates",
    );

    const beforeApi = await apiRequest(port, "GET", "/api/candidates");
    assert.equal(beforeApi.status, 200);
    const beforeCandidates = (
      beforeApi.json as { candidates: Array<{ id: number }> }
    ).candidates;
    const beforeIds = beforeCandidates.map((c) => c.id);
    assert.ok(
      beforeIds.includes(approveCandidateId),
      `approve candidate ${approveCandidateId} must be present before ops`,
    );
    assert.ok(
      beforeIds.includes(rejectCandidateId),
      `reject candidate ${rejectCandidateId} must be present before ops`,
    );
    assert.ok(
      beforeCandidates.length >= 2,
      `expected >=2 candidates before ops, got ${beforeCandidates.length}`,
    );

    const cardsBefore = window.document.querySelectorAll(".candidate-card");
    assert.ok(
      cardsBefore.length >= 2,
      `UI must show >=2 candidates, got ${cardsBefore.length}`,
    );

    const candidatesStatus = window.document.querySelector(
      '[data-testid="candidates-status"]',
    );
    assert.ok(candidatesStatus, "candidates status region required");
    assert.ok(candidatesStatus!.getAttribute("aria-live"));

    // --- Approve path (unconditional) ---
    const approveBtn = window.document.querySelector(
      `[data-testid="approve-${approveCandidateId}"]`,
    ) as HTMLButtonElement | null;
    assert.ok(approveBtn, `approve button for candidate ${approveCandidateId}`);
    click(approveBtn!);
    await waitFor(
      () => !window.document.querySelector(`[data-candidate-id="${approveCandidateId}"]`),
      "approved candidate removed from UI",
    );

    const afterApprove = await apiRequest(port, "GET", "/api/candidates");
    const afterApproveIds = (
      afterApprove.json as { candidates: Array<{ id: number }> }
    ).candidates.map((c) => c.id);
    assert.ok(
      !afterApproveIds.includes(approveCandidateId),
      "approved candidate suppressed from API",
    );

    const listingsAfterApprove = await apiRequest(port, "GET", "/api/listings");
    const approveRows = (
      listingsAfterApprove.json as { listings: ListingRow[] }
    ).listings.filter(
      (r) => r.cid === "RJ_E2E_APPROVE_A" || r.cid === "d_e2e_approve_b",
    );
    assert.equal(approveRows.length, 2);
    assert.equal(approveRows[0]!.workId, approveRows[1]!.workId, "approve merges work_id");
    assert.equal(approveRows[0]!.workIdLocked, true);
    assert.equal(approveRows[1]!.workIdLocked, true);

    const residualApprove = db
      .prepare(
        `SELECT COUNT(*) AS n FROM candidate
         WHERE id = ? OR listing_a_id IN (?, ?) OR listing_b_id IN (?, ?)`,
      )
      .get(
        approveCandidateId,
        approveListingIds.a,
        approveListingIds.b,
        approveListingIds.a,
        approveListingIds.b,
      ) as { n: number };
    assert.equal(residualApprove.n, 0, "approve suppresses candidate rows in DB");

    // --- Reject path (unconditional; distinct candidate) ---
    assert.ok(
      afterApproveIds.includes(rejectCandidateId),
      "reject candidate must still exist after approve",
    );
    await waitFor(
      () =>
        window.document.querySelector(
          `[data-testid="reject-${rejectCandidateId}"]`,
        ) !== null,
      "reject button visible",
    );
    const rejectBtn = window.document.querySelector(
      `[data-testid="reject-${rejectCandidateId}"]`,
    ) as HTMLButtonElement;
    click(rejectBtn);
    await waitFor(
      () => !window.document.querySelector(`[data-candidate-id="${rejectCandidateId}"]`),
      "rejected candidate removed from UI",
    );

    const afterReject = await apiRequest(port, "GET", "/api/candidates");
    const afterRejectIds = (
      afterReject.json as { candidates: Array<{ id: number }> }
    ).candidates.map((c) => c.id);
    assert.ok(
      !afterRejectIds.includes(rejectCandidateId),
      "rejected candidate suppressed from API",
    );

    const listingsAfterReject = await apiRequest(port, "GET", "/api/listings");
    const rejectRows = (
      listingsAfterReject.json as { listings: ListingRow[] }
    ).listings.filter(
      (r) => r.cid === "RJ_E2E_REJECT_A" || r.cid === "b_e2e_reject_b",
    );
    assert.equal(rejectRows.length, 2);
    assert.equal(rejectRows[0]!.workIdLocked, true);
    assert.equal(rejectRows[1]!.workIdLocked, true);
    // Distinct initial works stay separate on reject (or get split if they shared).
    assert.notEqual(
      rejectRows.find((r) => r.cid === "RJ_E2E_REJECT_A")!.workId,
      undefined,
    );
    // Both locked; if they started separate they remain separate.
    const rejectWorkIds = new Set(rejectRows.map((r) => r.workId));
    assert.equal(rejectWorkIds.size, 2, "reject keeps listings on separate works");

    const residualReject = db
      .prepare(
        `SELECT COUNT(*) AS n FROM candidate
         WHERE id = ? OR listing_a_id IN (?, ?) OR listing_b_id IN (?, ?)`,
      )
      .get(
        rejectCandidateId,
        rejectListingIds.a,
        rejectListingIds.b,
        rejectListingIds.a,
        rejectListingIds.b,
      ) as { n: number };
    assert.equal(residualReject.n, 0, "reject suppresses candidate rows in DB");
  });

  it("shows visible API error and prevents double mutation on approve", async () => {
    // Seed a fresh candidate solely for mutation-guard coverage.
    const a = insertListing(db, {
      source: "dlsite",
      cid: "RJ_E2E_GUARD_A",
      title: "Guard Pair Alpha",
      maker: "Guard Maker",
    });
    const b = insertListing(db, {
      source: "fanza_doujin",
      cid: "d_e2e_guard_b",
      title: "Guard Pair Beta",
      maker: "Guard Maker",
    });
    const guardId = insertCandidate(db, a, b, 0.93);

    const navCandidates = window.document.querySelector(
      'nav a[href="/candidates"]',
    ) as HTMLAnchorElement;
    click(navCandidates);
    await waitFor(
      () => window.document.querySelector(`[data-candidate-id="${guardId}"]`) !== null,
      "guard candidate visible",
    );

    const originalFetch = globalThis.fetch;
    let postCalls = 0;
    let releaseHold: (() => void) | null = null;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });

    defineGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST" && url.includes(`/api/candidates/${guardId}`)) {
        postCalls += 1;
        if (postCalls === 1) {
          await hold;
          return new Response(JSON.stringify({ error: "forced failure" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        // Any subsequent POST would be a double mutation — fail loudly if reached.
        return new Response(JSON.stringify({ error: "duplicate blocked in test" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(input as never, init);
    });

    try {
      const approveBtn = window.document.querySelector(
        `[data-testid="approve-${guardId}"]`,
      ) as HTMLButtonElement;
      assert.ok(approveBtn);
      click(approveBtn);
      click(approveBtn); // second click while pending must not issue another POST

      await waitFor(() => approveBtn.disabled === true, "approve disabled while pending");
      assert.equal(postCalls, 1, "only one mutation in flight while pending");

      releaseHold!();
      await waitFor(
        () => {
          const status = window.document.querySelector(
            '[data-testid="candidates-status"]',
          );
          return (
            status?.getAttribute("data-kind") === "error" &&
            (status.textContent ?? "").length > 0
          );
        },
        "visible error status after API failure",
      );

      const status = window.document.querySelector(
        '[data-testid="candidates-status"]',
      ) as HTMLElement;
      assert.equal(status.getAttribute("role"), "alert");
      assert.equal(status.getAttribute("aria-live"), "assertive");
      assert.match(status.textContent ?? "", /API 500|forced failure|error/i);

      await waitFor(() => approveBtn.disabled === false, "approve re-enabled after error");
      assert.equal(postCalls, 1, "double-click must not create a second mutation");

      // Candidate still present in API/UI after failed mutation.
      const still = await apiRequest(port, "GET", "/api/candidates");
      const stillIds = (still.json as { candidates: Array<{ id: number }> }).candidates.map(
        (c) => c.id,
      );
      assert.ok(stillIds.includes(guardId), "failed approve must leave candidate intact");
      assert.ok(
        window.document.querySelector(`[data-candidate-id="${guardId}"]`),
        "failed approve keeps card in UI",
      );
    } finally {
      defineGlobal("fetch", originalFetch);
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
