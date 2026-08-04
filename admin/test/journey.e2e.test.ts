import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";
import { openDatabase } from "../../server/src/db.js";
import { handleApi } from "../../server/src/http.js";
import { handleStatic } from "../../server/src/static.js";
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

describe("e2e admin core journey", () => {
  let server: Server;
  let port: number;
  let db: DatabaseSync;

  before(async () => {
    assert.ok(existsSync(join(ADMIN_DIST, "index.html")), "admin dist must be built");
    assert.ok(existsSync(join(ADMIN_DIST, "main.js")), "admin dist must be built");

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

    runRematch(db);

    ({ server, port } = await startFullServer(db));
  });

  after(() => {
    server.close();
    db.close();
  });

  it("serves navigable admin SPA shell", async () => {
    const home = await apiRequest(port, "GET", "/");
    assert.equal(home.status, 200);
    assert.match(home.text, /ADP 管理/);
    assert.match(home.text, /main\.js/);

    const candidatesPage = await apiRequest(port, "GET", "/candidates");
    assert.equal(candidatesPage.status, 200);
    assert.match(candidatesPage.text, /main\.js/);
  });

  it("runs library search, candidate decisions, and manual work lock journey", async () => {
    const library = await apiRequest(port, "GET", "/api/listings");
    assert.equal(library.status, 200);
    const allListings = (library.json as {
      listings: Array<{ source: string; title: string; workId: number }>;
      total: number;
    }).listings;
    assert.ok(allListings.length >= 4);
    assert.ok((library.json as { total: number }).total >= 4);

    const sources = new Set(allListings.map((l) => l.source));
    assert.ok(sources.has("dlsite"));
    assert.ok(sources.has("fanza_doujin"));

    const search = await apiRequest(port, "GET", "/api/listings?q=Journey");
    const journeyRows = (search.json as {
      listings: Array<{ title: string; workId: number }>;
    }).listings;
    assert.ok(journeyRows.length >= 2);

    const candidatesBefore = await apiRequest(port, "GET", "/api/candidates");
    assert.equal(candidatesBefore.status, 200);
    const queue = (candidatesBefore.json as { candidates: Array<{ id: number; dice: number }> })
      .candidates;
    assert.ok(queue.length >= 1);
    assert.ok(queue.every((c) => c.dice >= 0.7));

    const approveId = queue[0]!.id;
    const approve = await apiRequest(port, "POST", `/api/candidates/${approveId}`, { same: true });
    assert.equal(approve.status, 200);

    const afterApprove = await apiRequest(port, "GET", "/api/candidates");
    const afterIds = (afterApprove.json as { candidates: Array<{ id: number }> }).candidates.map(
      (c) => c.id,
    );
    assert.ok(!afterIds.includes(approveId));

    const remaining = (afterApprove.json as { candidates: Array<{ id: number }> }).candidates;
    if (remaining.length > 0) {
      const rejectId = remaining[0]!.id;
      const reject = await apiRequest(port, "POST", `/api/candidates/${rejectId}`, { same: false });
      assert.equal(reject.status, 200);
      const afterReject = await apiRequest(port, "GET", "/api/candidates");
      const rejectIds = (afterReject.json as { candidates: Array<{ id: number }> }).candidates.map(
        (c) => c.id,
      );
      assert.ok(!rejectIds.includes(rejectId));
    }

    const listingsForWork = await apiRequest(port, "GET", "/api/listings?q=Journey");
    const rows = (listingsForWork.json as {
      listings: Array<{ source: string; cid: string; workId: number; workIdLocked?: boolean }>;
    }).listings;
    const maxWork = rows.reduce((m, r) => Math.max(m, r.workId), 0);
    const splitTarget = rows.find((r) => r.source === "fanza_dlsoft");
    assert.ok(splitTarget);
    const split = await apiRequest(
      port,
      "POST",
      `/api/listings/${splitTarget.source}/${splitTarget.cid}/work`,
      { workId: maxWork + 1, lock: true },
    );
    assert.equal(split.status, 200);

    const finalLibrary = await apiRequest(port, "GET", "/api/listings?q=Journey");
    const finalRows = (finalLibrary.json as {
      listings: Array<{ cid: string; workId: number; workIdLocked?: boolean }>;
    }).listings;
    const splitRow = finalRows.find((r) => r.cid === splitTarget.cid);
    assert.ok(splitRow?.workIdLocked);
    assert.equal(splitRow.workId, maxWork + 1);
  });
});
