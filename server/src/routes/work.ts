import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError, z } from "zod";
import {
  ListingWorkPathSchema,
  WorkAssignmentResponseSchema,
  normalizeCid,
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

function ensureWorkExists(db: ApiContext["db"], workId: number): void {
  const exists = db.prepare("SELECT 1 FROM work WHERE id = ?").get(workId);
  if (!exists) {
    db.prepare("INSERT INTO work (id) VALUES (?)").run(workId);
  }
}

function allocateNewWork(db: ApiContext["db"]): number {
  db.prepare("INSERT INTO work DEFAULT VALUES").run();
  return Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id);
}

/**
 * Trust-boundary body for work assignment.
 * Shared contract still requires workId for explicit merge; split uses allocateNew
 * so the client never invents a work id (avoids hidden-work collisions).
 */
const LocalWorkAssignmentSchema = z.union([
  z
    .object({
      workId: z.number().int().positive(),
      lock: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      allocateNew: z.literal(true),
      lock: z.boolean().optional(),
    })
    .strict(),
]);

function runInTransaction<T>(db: ApiContext["db"], fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // ignore rollback failure after a failed transaction
    }
    throw error;
  }
}

async function handleWorkRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
  url: URL,
): Promise<boolean> {
  const method = req.method ?? "POST";
  const match = url.pathname.match(/^\/api\/listings\/([^/]+)\/([^/]+)\/work$/);
  if (method !== "POST" || !match) return false;

  const pathParams = parseZod(ListingWorkPathSchema, {
    source: match[1],
    cid: match[2],
  });
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
  const parsed = parseZod(LocalWorkAssignmentSchema, body);
  if (!parsed) {
    validationError(res);
    return true;
  }

  const cid = normalizeCid(pathParams.source, pathParams.cid);
  const listing = ctx.db
    .prepare("SELECT id FROM listing WHERE source = ? AND cid = ?")
    .get(pathParams.source, cid) as { id: number } | undefined;
  if (!listing) {
    notFound(res);
    return true;
  }

  const locked = parsed.lock ?? true;
  const workId = runInTransaction(ctx.db, () => {
    const assigned =
      "allocateNew" in parsed && parsed.allocateNew
        ? allocateNewWork(ctx.db)
        : (() => {
            const explicit = (parsed as { workId: number }).workId;
            ensureWorkExists(ctx.db, explicit);
            return explicit;
          })();
    ctx.db
      .prepare("UPDATE listing SET work_id = ?, work_id_locked = ? WHERE id = ?")
      .run(assigned, locked ? 1 : 0, listing.id);
    return assigned;
  });

  json(
    res,
    200,
    WorkAssignmentResponseSchema.parse({
      workId,
      locked,
    }),
  );
  return true;
}

/** Register manual work assignment route (T-ADMIN-CORE). */
export function registerWorkRoutes(): void {
  registerApiRouteMount(handleWorkRoute);
}

registerWorkRoutes();
