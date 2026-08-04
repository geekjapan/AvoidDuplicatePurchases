import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { openDatabase } from "../src/db.js";
import { handleApi } from "../src/http.js";
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

function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
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
            resolve({
              status: res.statusCode ?? 0,
              json: text.length ? JSON.parse(text) : null,
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

function startTestServer(db: DatabaseSync): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    let listenPort = 0;
    const server = createServer(async (req, res) => {
      await handleApi(req, res, { db, port: listenPort, extensionOrigins: new Set() });
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

  it("manual merge and split lock work_id", async () => {
    const before = await request(port, "GET", "/api/listings");
    const rows = (before.json as {
      listings: Array<{ source: string; cid: string; workId: number; workIdLocked?: boolean }>;
    }).listings;
    const maxWork = Math.max(...rows.map((r) => r.workId));
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
      { workId: maxWork + 1, lock: true },
    );
    assert.equal(split.status, 200);

    const afterSplit = await request(port, "GET", "/api/listings");
    const afterRows = (afterSplit.json as {
      listings: Array<{ cid: string; workId: number; workIdLocked?: boolean }>;
    }).listings;
    const splitRow = afterRows.find((r) => r.cid === "d_600001");
    const otherRow = afterRows.find((r) => r.cid === "RJ600001");
    assert.ok(splitRow && otherRow);
    assert.notEqual(splitRow.workId, otherRow.workId);
    assert.equal(splitRow.workIdLocked, true);
  });
});
