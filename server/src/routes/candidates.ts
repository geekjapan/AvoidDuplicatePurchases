import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError } from "zod";
import {
  CandidatesQuerySchema,
  CandidatesResponseSchema,
  CandidatePairSchema,
  CandidateIdPathSchema,
  CandidateDecisionSchema,
  EmptyResponseSchema,
  type Source,
} from "@adp/shared";
import { registerApiRouteMount } from "../route-mounts.js";
import type { ApiContext } from "../http.js";

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function parseZod<T>(schema: { parse: (v: unknown) => T }, value: unknown): T | null {
  try {
    return schema.parse(value);
  } catch (err) {
    if (err instanceof ZodError) return null;
    throw err;
  }
}

function validationError(res: ServerResponse): void {
  json(res, 400, { error: "invalid_request" });
}

function notFound(res: ServerResponse): void {
  json(res, 404, { error: "not_found" });
}

interface ListingSide {
  source: Source;
  cid: string;
  title: string;
  maker_name: string | null;
}

function listingSide(row: ListingSide) {
  return {
    source: row.source,
    cid: row.cid,
    title: row.title,
    maker: row.maker_name,
  };
}

function ensureWorkExists(db: ApiContext["db"], workId: number): void {
  const exists = db.prepare("SELECT 1 FROM work WHERE id = ?").get(workId);
  if (!exists) {
    db.prepare("INSERT INTO work (id) VALUES (?)").run(workId);
  }
}

function createWork(db: ApiContext["db"]): number {
  db.prepare("INSERT INTO work DEFAULT VALUES").run();
  return Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id);
}

function lockListing(db: ApiContext["db"], listingId: number, workId: number): void {
  db.prepare(
    "UPDATE listing SET work_id = ?, work_id_locked = 1 WHERE id = ?",
  ).run(workId, listingId);
}

/** Remove every candidate that references either processed listing. */
function deleteCandidatesForListings(
  db: ApiContext["db"],
  listingAId: number,
  listingBId: number,
): void {
  db.prepare(
    `DELETE FROM candidate
     WHERE listing_a_id IN (?, ?)
        OR listing_b_id IN (?, ?)`,
  ).run(listingAId, listingBId, listingAId, listingBId);
}

function runInTransaction(db: ApiContext["db"], fn: () => void): void {
  db.exec("BEGIN");
  try {
    fn();
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore rollback failure after a failed transaction
    }
    throw error;
  }
}

async function handleCandidatesRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
  url: URL,
): Promise<boolean> {
  const method = req.method ?? "GET";

  if (method === "GET" && url.pathname === "/api/candidates") {
    const query = parseZod(CandidatesQuerySchema, {
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!query) {
      validationError(res);
      return true;
    }

    const limit = query.limit ?? 50;
    // Only unlocked listings may appear; locked ones are already decided.
    const rows = ctx.db
      .prepare(
        `SELECT c.id, c.dice,
                la.source AS a_source, la.cid AS a_cid, la.title AS a_title, la.maker_name AS a_maker,
                lb.source AS b_source, lb.cid AS b_cid, lb.title AS b_title, lb.maker_name AS b_maker
         FROM candidate c
         JOIN listing la ON la.id = c.listing_a_id
         JOIN listing lb ON lb.id = c.listing_b_id
         WHERE la.work_id_locked = 0 AND lb.work_id_locked = 0
         ORDER BY c.dice DESC, c.id
         LIMIT ?`,
      )
      .all(limit) as Array<{
      id: number;
      dice: number;
      a_source: Source;
      a_cid: string;
      a_title: string;
      a_maker: string | null;
      b_source: Source;
      b_cid: string;
      b_title: string;
      b_maker: string | null;
    }>;

    const candidates = rows.map((row) =>
      CandidatePairSchema.parse({
        id: row.id,
        dice: row.dice,
        a: listingSide({
          source: row.a_source,
          cid: row.a_cid,
          title: row.a_title,
          maker_name: row.a_maker,
        }),
        b: listingSide({
          source: row.b_source,
          cid: row.b_cid,
          title: row.b_title,
          maker_name: row.b_maker,
        }),
      }),
    );

    json(res, 200, CandidatesResponseSchema.parse({ candidates }));
    return true;
  }

  const decideMatch = url.pathname.match(/^\/api\/candidates\/(\d+)$/);
  if (method === "POST" && decideMatch) {
    const pathParams = parseZod(CandidateIdPathSchema, { id: decideMatch[1] });
    if (!pathParams) {
      validationError(res);
      return true;
    }

    const raw = await readBody(req);
    let body: unknown;
    try {
      body = raw.length ? JSON.parse(raw) : null;
    } catch {
      validationError(res);
      return true;
    }
    const decision = parseZod(CandidateDecisionSchema, body);
    if (!decision) {
      validationError(res);
      return true;
    }

    const candidate = ctx.db
      .prepare(
        "SELECT id, listing_a_id, listing_b_id FROM candidate WHERE id = ?",
      )
      .get(pathParams.id) as
      | { id: number; listing_a_id: number; listing_b_id: number }
      | undefined;
    if (!candidate) {
      notFound(res);
      return true;
    }

    const listingA = ctx.db
      .prepare("SELECT id, work_id FROM listing WHERE id = ?")
      .get(candidate.listing_a_id) as { id: number; work_id: number } | undefined;
    const listingB = ctx.db
      .prepare("SELECT id, work_id FROM listing WHERE id = ?")
      .get(candidate.listing_b_id) as { id: number; work_id: number } | undefined;
    if (!listingA || !listingB) {
      notFound(res);
      return true;
    }

    runInTransaction(ctx.db, () => {
      if (decision.same) {
        // Approve: merge onto the smaller work_id and lock both sides.
        const targetWorkId = Math.min(listingA.work_id, listingB.work_id);
        ensureWorkExists(ctx.db, targetWorkId);
        lockListing(ctx.db, listingA.id, targetWorkId);
        lockListing(ctx.db, listingB.id, targetWorkId);
      } else if (listingA.work_id === listingB.work_id) {
        // Reject while still sharing a work: keep A, allocate a fresh work for B.
        const newWorkId = createWork(ctx.db);
        lockListing(ctx.db, listingA.id, listingA.work_id);
        lockListing(ctx.db, listingB.id, newWorkId);
      } else {
        // Reject already-separate pair: lock each on its own work.
        lockListing(ctx.db, listingA.id, listingA.work_id);
        lockListing(ctx.db, listingB.id, listingB.work_id);
      }

      // Suppress every candidate involving either processed listing.
      deleteCandidatesForListings(ctx.db, listingA.id, listingB.id);
    });

    json(res, 200, EmptyResponseSchema.parse({}));
    return true;
  }

  return false;
}

/** Register candidate queue routes (T-ADMIN-CORE). */
export function registerCandidatesRoutes(): void {
  registerApiRouteMount(handleCandidatesRoute);
}

registerCandidatesRoutes();
