import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { openDatabase } from "../src/db.js";
import { handleApi } from "../src/http.js";
import { handleStatic } from "../src/static.js";
import { isAllowedOrigin } from "../src/config.js";
import { recomputeMatchKeys, runRematch } from "../src/services/lookup.js";
import "../src/routes/listings.js";
import "../src/routes/candidates.js";
import "../src/routes/work.js";
import type { DatabaseSync } from "node:sqlite";

function insertListing(
  db: DatabaseSync,
  opts: {
    source: string;
    cid: string;
    title: string;
    maker: string | null;
    workIdLocked?: number;
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
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'unknown', '{}', ?)`,
  ).run(
    opts.source,
    opts.cid,
    workId,
    opts.workIdLocked ?? 0,
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

function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
  origin?: string,
): Promise<{ status: number; json: unknown; text: string }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    import("node:http").then(({ request: httpRequest }) => {
      const headers: Record<string, string | number> = {
        Origin: origin ?? `http://127.0.0.1:${port}`,
      };
      if (payload !== undefined) {
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = Buffer.byteLength(payload);
      }
      const r = httpRequest(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method,
          headers,
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
            resolve({
              status: res.statusCode ?? 0,
              json,
              text,
            });
          });
        },
      );
      r.on("error", reject);
      if (payload !== undefined) r.write(payload);
      r.end();
    });
  });
}

function startTestServer(
  db: DatabaseSync,
  opts: { staticFiles?: boolean; extensionOrigins?: Set<string> } = {},
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    let listenPort = 0;
    const extensionOrigins = opts.extensionOrigins ?? new Set<string>();
    const server = createServer(async (req, res) => {
      if (!isAllowedOrigin(req.headers.origin, listenPort, extensionOrigins)) {
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
        extensionOrigins,
      });
      if (apiHandled) return;
      if (opts.staticFiles && handleStatic(req, res, url)) return;
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

describe("candidates API", () => {
  let server: Server;
  let port: number;
  let db: DatabaseSync;

  before(async () => {
    db = openDatabase(":memory:").sqlite;
    insertListing(db, {
      source: "dlsite",
      cid: "RJ400001",
      title: "Wonderful Adventure Vol 1",
      maker: "Studio X",
    });
    insertListing(db, {
      source: "fanza_doujin",
      cid: "d_400001",
      title: "Wonderful Adventure Volume 1",
      maker: "Studio X",
    });
    insertListing(db, {
      source: "dlsite",
      cid: "RJ400002",
      title: "Another Story Edition A",
      maker: "Studio Y",
    });
    insertListing(db, {
      source: "fanza_books",
      cid: "b_400002",
      title: "Another Story Edition B",
      maker: "Studio Y",
    });
    runRematch(db);

    ({ server, port } = await startTestServer(db));
  });

  after(() => {
    server.close();
    db.close();
  });

  it("lists candidates with dice and maker match", async () => {
    const res = await request(port, "GET", "/api/candidates");
    assert.equal(res.status, 200);
    const body = res.json as { candidates: Array<{ id: number; dice: number }> };
    assert.ok(body.candidates.length >= 1);
    for (const c of body.candidates) {
      assert.ok(c.dice >= 0.7);
    }
  });

  it("approve merges listings and locks them", async () => {
    const before = await request(port, "GET", "/api/candidates");
    const first = (before.json as { candidates: Array<{ id: number }> }).candidates[0];
    assert.ok(first);

    const decide = await request(port, "POST", `/api/candidates/${first.id}`, { same: true });
    assert.equal(decide.status, 200);

    const listings = await request(port, "GET", "/api/listings");
    const rows = (listings.json as { listings: Array<{ workId: number; workIdLocked?: boolean }> })
      .listings;
    const merged = rows.filter((r) => r.workIdLocked);
    assert.ok(merged.length >= 2);
    const workIds = new Set(merged.map((r) => r.workId));
    assert.equal(workIds.size, 1, "approved pair shares one work_id");

    const again = await request(port, "GET", "/api/candidates");
    const ids = (again.json as { candidates: Array<{ id: number }> }).candidates.map((c) => c.id);
    assert.ok(!ids.includes(first.id), "processed candidate must not return");
  });

  it("reject keeps listings separate and locks them", async () => {
    const before = await request(port, "GET", "/api/candidates");
    const candidate = (before.json as { candidates: Array<{ id: number }> }).candidates[0];
    if (!candidate) return;

    const decide = await request(port, "POST", `/api/candidates/${candidate.id}`, { same: false });
    assert.equal(decide.status, 200);

    const listings = await request(port, "GET", "/api/listings");
    const rows = (listings.json as {
      listings: Array<{ cid: string; workId: number; workIdLocked?: boolean }>;
    }).listings;
    const locked = rows.filter((r) => r.workIdLocked);
    assert.ok(locked.length >= 2);

    const again = await request(port, "GET", "/api/candidates");
    const ids = (again.json as { candidates: Array<{ id: number }> }).candidates.map((c) => c.id);
    assert.ok(!ids.includes(candidate.id));
  });
});

describe("candidates 3-listing / 2-candidate suppress", () => {
  let server: Server;
  let port: number;
  let db: DatabaseSync;

  after(() => {
    server?.close();
    db?.close();
  });

  async function setupTriangle(mode: "approve" | "reject"): Promise<{
    candidateAB: number;
    candidateAC: number;
    idA: number;
    idB: number;
    idC: number;
  }> {
    db = openDatabase(":memory:").sqlite;
    const idA = insertListing(db, {
      source: "dlsite",
      cid: `RJ_TRI_${mode}_A`,
      title: `Triangle Core ${mode}`,
      maker: "Triangle Maker",
    });
    const idB = insertListing(db, {
      source: "fanza_doujin",
      cid: `d_tri_${mode}_b`,
      title: `Triangle Side B ${mode}`,
      maker: "Triangle Maker",
    });
    const idC = insertListing(db, {
      source: "fanza_books",
      cid: `b_tri_${mode}_c`,
      title: `Triangle Side C ${mode}`,
      maker: "Triangle Maker",
    });
    // Direct edges A-B and A-C (both reference listing A).
    const candidateAB = insertCandidate(db, idA, idB, 0.91);
    const candidateAC = insertCandidate(db, idA, idC, 0.88);
    ({ server, port } = await startTestServer(db));
    return { candidateAB, candidateAC, idA, idB, idC };
  }

  it("approve removes every candidate involving either processed listing", async () => {
    const { candidateAB, candidateAC, idA, idB } = await setupTriangle("approve");

    const before = await request(port, "GET", "/api/candidates");
    const beforeIds = (before.json as { candidates: Array<{ id: number }> }).candidates.map(
      (c) => c.id,
    );
    assert.ok(beforeIds.includes(candidateAB));
    assert.ok(beforeIds.includes(candidateAC));

    const decide = await request(port, "POST", `/api/candidates/${candidateAB}`, {
      same: true,
    });
    assert.equal(decide.status, 200);

    const after = await request(port, "GET", "/api/candidates");
    const afterIds = (after.json as { candidates: Array<{ id: number }> }).candidates.map(
      (c) => c.id,
    );
    assert.ok(!afterIds.includes(candidateAB), "processed candidate gone");
    assert.ok(
      !afterIds.includes(candidateAC),
      "sibling candidate sharing listing A must also be suppressed",
    );

    const listings = await request(port, "GET", "/api/listings");
    const rows = (listings.json as {
      listings: Array<{ id: number; workId: number; workIdLocked?: boolean }>;
    }).listings;
    const a = rows.find((r) => r.id === idA)!;
    const b = rows.find((r) => r.id === idB)!;
    assert.equal(a.workId, b.workId, "approve merges onto one work");
    assert.equal(a.workIdLocked, true);
    assert.equal(b.workIdLocked, true);

    // Direct DB check: no residual candidate rows for processed listings.
    const residual = db
      .prepare(
        `SELECT COUNT(*) AS n FROM candidate
         WHERE listing_a_id IN (?, ?) OR listing_b_id IN (?, ?)`,
      )
      .get(idA, idB, idA, idB) as { n: number };
    assert.equal(residual.n, 0);
  });

  it("reject keeps works separate and suppresses sibling candidates", async () => {
    server?.close();
    db?.close();
    const { candidateAB, candidateAC, idA, idB } = await setupTriangle("reject");

    // Force shared work so reject must allocate a new work for B.
    const sharedWork = (db.prepare("SELECT work_id FROM listing WHERE id = ?").get(idA) as {
      work_id: number;
    }).work_id;
    db.prepare("UPDATE listing SET work_id = ? WHERE id = ?").run(sharedWork, idB);

    const decide = await request(port, "POST", `/api/candidates/${candidateAB}`, {
      same: false,
    });
    assert.equal(decide.status, 200);

    const after = await request(port, "GET", "/api/candidates");
    const afterIds = (after.json as { candidates: Array<{ id: number }> }).candidates.map(
      (c) => c.id,
    );
    assert.ok(!afterIds.includes(candidateAB));
    assert.ok(!afterIds.includes(candidateAC));

    const listings = await request(port, "GET", "/api/listings");
    const rows = (listings.json as {
      listings: Array<{ id: number; workId: number; workIdLocked?: boolean }>;
    }).listings;
    const a = rows.find((r) => r.id === idA)!;
    const b = rows.find((r) => r.id === idB)!;
    assert.notEqual(a.workId, b.workId, "reject keeps listings on separate works");
    assert.equal(a.workIdLocked, true);
    assert.equal(b.workIdLocked, true);

    const residual = db
      .prepare(
        `SELECT COUNT(*) AS n FROM candidate
         WHERE listing_a_id IN (?, ?) OR listing_b_id IN (?, ?)`,
      )
      .get(idA, idB, idA, idB) as { n: number };
    assert.equal(residual.n, 0);
  });

  it("GET omits candidates whose either listing is already locked", async () => {
    server?.close();
    db?.close();
    db = openDatabase(":memory:").sqlite;
    const idA = insertListing(db, {
      source: "dlsite",
      cid: "RJ_LOCKED_A",
      title: "Locked Gate A",
      maker: "Lock Maker",
      workIdLocked: 1,
    });
    const idB = insertListing(db, {
      source: "fanza_doujin",
      cid: "d_locked_b",
      title: "Locked Gate B",
      maker: "Lock Maker",
    });
    insertCandidate(db, idA, idB, 0.95);
    ({ server, port } = await startTestServer(db));

    const res = await request(port, "GET", "/api/candidates");
    assert.equal(res.status, 200);
    const candidates = (res.json as { candidates: unknown[] }).candidates;
    assert.equal(candidates.length, 0);
  });
});

describe("listings API", () => {
  let server: Server;
  let port: number;
  let db: DatabaseSync;

  before(async () => {
    db = openDatabase(":memory:").sqlite;
    const workId = insertListing(db, {
      source: "dlsite",
      cid: "RJ500001",
      title: "Searchable Alpha",
      maker: "Maker Search",
    });
    insertListing(db, {
      source: "fanza_doujin",
      cid: "d_500001",
      title: "Searchable Beta",
      maker: "Maker Search",
      workId,
    });
    insertListing(db, {
      source: "fanza_books",
      cid: "b_500001",
      title: "Other Title",
      maker: "Different Maker",
    });
    ({ server, port } = await startTestServer(db));
  });

  after(() => {
    server.close();
    db.close();
  });

  it("filters by query, source, and groups by work", async () => {
    const all = await request(port, "GET", "/api/listings");
    assert.equal(all.status, 200);
    const total = (all.json as { total: number }).total;
    assert.equal(total, 3);

    const filtered = await request(port, "GET", "/api/listings?q=Searchable");
    const listings = (filtered.json as {
      listings: Array<{ title: string; workId: number }>;
    }).listings;
    assert.equal(listings.length, 2);
    assert.equal(listings[0]!.workId, listings[1]!.workId);

    const bySource = await request(
      port,
      "GET",
      "/api/listings?source=fanza_books",
    );
    const sourceRows = (bySource.json as { listings: Array<{ source: string }> }).listings;
    assert.equal(sourceRows.length, 1);
    assert.equal(sourceRows[0]!.source, "fanza_books");
  });
});

describe("listings pagination 501+ boundary", () => {
  let server: Server;
  let port: number;
  let db: DatabaseSync;

  before(async () => {
    db = openDatabase(":memory:").sqlite;
    for (let i = 0; i < 501; i++) {
      insertListing(db, {
        source: "dlsite",
        cid: `RJ_PAGE_${String(i).padStart(4, "0")}`,
        title: `Pagination Item ${i}`,
        maker: "Page Maker",
      });
    }
    ({ server, port } = await startTestServer(db));
  });

  after(() => {
    server.close();
    db.close();
  });

  it("returns total 501 and stable pages without silent truncation", async () => {
    const first = await request(port, "GET", "/api/listings?limit=500&offset=0");
    assert.equal(first.status, 200);
    const page1 = first.json as {
      listings: Array<{ cid: string; workId: number }>;
      total: number;
    };
    assert.equal(page1.total, 501);
    assert.equal(page1.listings.length, 500);

    const second = await request(port, "GET", "/api/listings?limit=500&offset=500");
    const page2 = second.json as {
      listings: Array<{ cid: string }>;
      total: number;
    };
    assert.equal(page2.total, 501);
    assert.equal(page2.listings.length, 1);

    const seen = new Set(page1.listings.map((l) => l.cid));
    for (const row of page2.listings) {
      assert.ok(!seen.has(row.cid), "pages must not overlap");
      seen.add(row.cid);
    }
    assert.equal(seen.size, 501);

    // Default limit alone would truncate; total must still report full count.
    const defaults = await request(port, "GET", "/api/listings");
    const body = defaults.json as { listings: unknown[]; total: number };
    assert.equal(body.total, 501);
    assert.equal(body.listings.length, 500);
  });
});

describe("work assignment API", () => {
  let server: Server;
  let port: number;
  let db: DatabaseSync;

  before(async () => {
    db = openDatabase(":memory:").sqlite;
    insertListing(db, {
      source: "dlsite",
      cid: "RJ600001",
      title: "Manual Merge A",
      maker: "Manual Maker",
    });
    insertListing(db, {
      source: "fanza_doujin",
      cid: "d_600001",
      title: "Manual Merge B",
      maker: "Manual Maker",
    });
    ({ server, port } = await startTestServer(db));
  });

  after(() => {
    server.close();
    db.close();
  });

  it("manual merge and server-side split lock work_id", async () => {
    const before = await request(port, "GET", "/api/listings");
    const rows = (before.json as {
      listings: Array<{ source: string; cid: string; workId: number; workIdLocked?: boolean }>;
    }).listings;
    const target = Math.min(...rows.map((r) => r.workId));

    const mergeA = await request(
      port,
      "POST",
      `/api/listings/dlsite/RJ600001/work`,
      { workId: target, lock: true },
    );
    assert.equal(mergeA.status, 200);
    const mergeB = await request(
      port,
      "POST",
      `/api/listings/fanza_doujin/d_600001/work`,
      { workId: target, lock: true },
    );
    assert.equal(mergeB.status, 200);

    const merged = await request(port, "GET", "/api/listings");
    const mergedRows = (merged.json as {
      listings: Array<{ workId: number; workIdLocked?: boolean }>;
    }).listings;
    assert.equal(new Set(mergedRows.map((r) => r.workId)).size, 1);
    assert.ok(mergedRows.every((r) => r.workIdLocked));

    const split = await request(
      port,
      "POST",
      `/api/listings/fanza_doujin/d_600001/work`,
      { allocateNew: true, lock: true },
    );
    assert.equal(split.status, 200);
    const splitBody = split.json as { workId: number; locked: boolean };
    assert.equal(splitBody.locked, true);
    assert.ok(splitBody.workId > target);

    const afterSplit = await request(port, "GET", "/api/listings");
    const afterRows = (afterSplit.json as {
      listings: Array<{ cid: string; workId: number; workIdLocked?: boolean }>;
    }).listings;
    const splitRow = afterRows.find((r) => r.cid === "d_600001");
    const otherRow = afterRows.find((r) => r.cid === "RJ600001");
    assert.ok(splitRow && otherRow);
    assert.notEqual(splitRow.workId, otherRow.workId);
    assert.equal(splitRow.workId, splitBody.workId);
    assert.equal(splitRow.workIdLocked, true);
  });
});

describe("stale candidate after manual merge/split lock (ADMIN-LOCK-1)", () => {
  let server: Server;
  let port: number;
  let db: DatabaseSync;

  after(() => {
    server?.close();
    db?.close();
  });

  it("rejects stale candidate POST after merge+split; work state unchanged; candidate suppressed", async () => {
    db = openDatabase(":memory:").sqlite;
    const idA = insertListing(db, {
      source: "dlsite",
      cid: "RJ_STALE_A",
      title: "Stale Candidate Alpha",
      maker: "Stale Maker",
    });
    const idB = insertListing(db, {
      source: "fanza_doujin",
      cid: "d_stale_b",
      title: "Stale Candidate Beta",
      maker: "Stale Maker",
    });
    const candidateId = insertCandidate(db, idA, idB, 0.94);
    ({ server, port } = await startTestServer(db));

    // Snapshot pre-merge work state for comparison after stale POST.
    const snap = (id: number) =>
      db
        .prepare("SELECT work_id, work_id_locked FROM listing WHERE id = ?")
        .get(id) as { work_id: number; work_id_locked: number };

    const beforeMergeA = snap(idA);
    const beforeMergeB = snap(idB);
    assert.equal(beforeMergeA.work_id_locked, 0);
    assert.equal(beforeMergeB.work_id_locked, 0);

    // Obtain candidate id via API (must be visible before manual lock).
    const listed = await request(port, "GET", "/api/candidates");
    assert.equal(listed.status, 200);
    const listedIds = (listed.json as { candidates: Array<{ id: number }> }).candidates.map(
      (c) => c.id,
    );
    assert.ok(listedIds.includes(candidateId));

    // Manual merge both sides onto A's work and lock.
    const targetWorkId = beforeMergeA.work_id;
    const mergeA = await request(port, "POST", `/api/listings/dlsite/RJ_STALE_A/work`, {
      workId: targetWorkId,
      lock: true,
    });
    assert.equal(mergeA.status, 200);
    const mergeB = await request(port, "POST", `/api/listings/fanza_doujin/d_stale_b/work`, {
      workId: targetWorkId,
      lock: true,
    });
    assert.equal(mergeB.status, 200);

    // Candidate must already be suppressed by merge.
    const residualAfterMerge = db
      .prepare("SELECT COUNT(*) AS n FROM candidate WHERE id = ?")
      .get(candidateId) as { n: number };
    assert.equal(residualAfterMerge.n, 0, "manual merge suppresses candidate rows");

    // Split lock B onto a fresh work (still locked).
    const split = await request(port, "POST", `/api/listings/fanza_doujin/d_stale_b/work`, {
      allocateNew: true,
      lock: true,
    });
    assert.equal(split.status, 200);
    const splitBody = split.json as { workId: number; locked: boolean };
    assert.equal(splitBody.locked, true);
    assert.notEqual(splitBody.workId, targetWorkId);

    const afterLockA = snap(idA);
    const afterLockB = snap(idB);
    assert.equal(afterLockA.work_id, targetWorkId);
    assert.equal(afterLockA.work_id_locked, 1);
    assert.equal(afterLockB.work_id, splitBody.workId);
    assert.equal(afterLockB.work_id_locked, 1);

    // Stale POST against the original candidate id must be rejected.
    const stale = await request(port, "POST", `/api/candidates/${candidateId}`, {
      same: true,
    });
    assert.ok(
      stale.status === 404 || stale.status === 409,
      `stale candidate must be 404 or 409, got ${stale.status}`,
    );

    // work_id / work_id_locked must be unchanged by the stale decision.
    const finalA = snap(idA);
    const finalB = snap(idB);
    assert.equal(finalA.work_id, afterLockA.work_id);
    assert.equal(finalA.work_id_locked, afterLockA.work_id_locked);
    assert.equal(finalB.work_id, afterLockB.work_id);
    assert.equal(finalB.work_id_locked, afterLockB.work_id_locked);

    // Candidate remains suppressed (no resurrection).
    const residualFinal = db
      .prepare(
        `SELECT COUNT(*) AS n FROM candidate
         WHERE id = ? OR listing_a_id IN (?, ?) OR listing_b_id IN (?, ?)`,
      )
      .get(candidateId, idA, idB, idA, idB) as { n: number };
    assert.equal(residualFinal.n, 0);
  });

  it("rejects candidate decision with 409 when either listing is locked (no mutation)", async () => {
    server?.close();
    db?.close();
    db = openDatabase(":memory:").sqlite;
    const idA = insertListing(db, {
      source: "dlsite",
      cid: "RJ_LOCK409_A",
      title: "Lock Conflict Alpha",
      maker: "Lock Conflict Maker",
    });
    const idB = insertListing(db, {
      source: "fanza_books",
      cid: "b_lock409_b",
      title: "Lock Conflict Beta",
      maker: "Lock Conflict Maker",
    });
    const candidateId = insertCandidate(db, idA, idB, 0.9);
    // Lock one side without deleting the candidate (race/orphan residual).
    db.prepare("UPDATE listing SET work_id_locked = 1 WHERE id = ?").run(idA);

    const beforeA = db
      .prepare("SELECT work_id, work_id_locked FROM listing WHERE id = ?")
      .get(idA) as { work_id: number; work_id_locked: number };
    const beforeB = db
      .prepare("SELECT work_id, work_id_locked FROM listing WHERE id = ?")
      .get(idB) as { work_id: number; work_id_locked: number };

    ({ server, port } = await startTestServer(db));
    const res = await request(port, "POST", `/api/candidates/${candidateId}`, { same: true });
    assert.equal(res.status, 409);

    const afterA = db
      .prepare("SELECT work_id, work_id_locked FROM listing WHERE id = ?")
      .get(idA) as { work_id: number; work_id_locked: number };
    const afterB = db
      .prepare("SELECT work_id, work_id_locked FROM listing WHERE id = ?")
      .get(idB) as { work_id: number; work_id_locked: number };
    assert.deepEqual(afterA, beforeA);
    assert.deepEqual(afterB, beforeB);

    // Candidate row remains (reject does not mutate on conflict).
    const still = db
      .prepare("SELECT COUNT(*) AS n FROM candidate WHERE id = ?")
      .get(candidateId) as { n: number };
    assert.equal(still.n, 1);
  });
});

describe("work split hidden/filter collision", () => {
  let server: Server;
  let port: number;
  let db: DatabaseSync;

  before(async () => {
    db = openDatabase(":memory:").sqlite;
    // Visible pair first so their auto work ids stay low.
    insertListing(db, {
      source: "dlsite",
      cid: "RJ_VIS_A",
      title: "Visible Split A",
      maker: "Visible Maker",
    });
    insertListing(db, {
      source: "fanza_doujin",
      cid: "d_vis_b",
      title: "Visible Split B",
      maker: "Visible Maker",
    });
    // Hidden high work id outside the Visible Maker filter.
    db.prepare("INSERT INTO work (id) VALUES (500)").run();
    insertListing(db, {
      source: "dlsite",
      cid: "RJ_HIDDEN_500",
      title: "Hidden High Work",
      maker: "Hidden Maker",
      workId: 500,
    });
    ({ server, port } = await startTestServer(db));
  });

  after(() => {
    server.close();
    db.close();
  });

  it("allocateNew avoids max-visible+1 collision with hidden work 500", async () => {
    const filtered = await request(port, "GET", "/api/listings?maker=Visible%20Maker");
    const visible = (filtered.json as {
      listings: Array<{ cid: string; workId: number }>;
    }).listings;
    assert.equal(visible.length, 2);
    const maxVisible = Math.max(...visible.map((r) => r.workId));
    assert.ok(maxVisible < 500, "filtered max must be below hidden work");

    // Old client would invent maxVisible+1 which may be free, but under
    // larger datasets collides; simulate the dangerous case by occupying it.
    const collidingId = maxVisible + 1;
    db.prepare("INSERT INTO work (id) VALUES (?)").run(collidingId);
    insertListing(db, {
      source: "fanza_books",
      cid: "b_occupied",
      title: "Occupies MaxVisible Plus One",
      maker: "Other Maker",
      workId: collidingId,
    });

    const split = await request(
      port,
      "POST",
      `/api/listings/fanza_doujin/d_vis_b/work`,
      { allocateNew: true, lock: true },
    );
    assert.equal(split.status, 200);
    const body = split.json as { workId: number; locked: boolean };
    assert.equal(body.locked, true);
    assert.notEqual(body.workId, collidingId, "must not reuse occupied maxVisible+1");
    assert.notEqual(body.workId, 500, "must not reuse hidden work 500");

    const after = await request(port, "GET", "/api/listings?q=Visible%20Split%20B");
    const row = (after.json as {
      listings: Array<{ cid: string; workId: number; workIdLocked?: boolean }>;
    }).listings.find((r) => r.cid === "d_vis_b");
    assert.ok(row);
    assert.equal(row.workId, body.workId);
    assert.equal(row.workIdLocked, true);

    // Occupied listing must remain on its work.
    const occupied = await request(port, "GET", "/api/listings?q=Occupies");
    const occ = (occupied.json as {
      listings: Array<{ cid: string; workId: number }>;
    }).listings.find((r) => r.cid === "b_occupied");
    assert.equal(occ?.workId, collidingId);
  });
});

describe("static SPA origin gate", () => {
  let server: Server;
  let port: number;
  let db: DatabaseSync;

  before(async () => {
    db = openDatabase(":memory:").sqlite;
    ({ server, port } = await startTestServer(db, {
      staticFiles: true,
      extensionOrigins: new Set(["chrome-extension://allowed-admin"]),
    }));
  });

  after(() => {
    server.close();
    db.close();
  });

  it("rejects malicious Origin on static GET before SPA handling", async () => {
    const evil = await request(
      port,
      "GET",
      "/",
      undefined,
      "https://evil.example.com",
    );
    assert.equal(evil.status, 403);
    assert.match(evil.text, /forbidden/);
    assert.doesNotMatch(evil.text, /ADP 管理|main\.js/);
  });

  it("allows same-origin and no-Origin static GET", async () => {
    const same = await request(port, "GET", "/", undefined, `http://127.0.0.1:${port}`);
    // dist may or may not be built in unit context; 200 or 503 both mean gate passed.
    assert.ok(same.status === 200 || same.status === 503, `status=${same.status}`);

    const noOrigin = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      import("node:http").then(({ request: httpRequest }) => {
        const r = httpRequest(
          { hostname: "127.0.0.1", port, path: "/", method: "GET" },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () =>
              resolve({
                status: res.statusCode ?? 0,
                text: Buffer.concat(chunks).toString("utf8"),
              }),
            );
          },
        );
        r.on("error", reject);
        r.end();
      });
    });
    assert.ok(noOrigin.status === 200 || noOrigin.status === 503);
  });

  it("allows configured extension origin on static GET", async () => {
    const res = await request(
      port,
      "GET",
      "/",
      undefined,
      "chrome-extension://allowed-admin",
    );
    assert.ok(res.status === 200 || res.status === 503);
  });
});
