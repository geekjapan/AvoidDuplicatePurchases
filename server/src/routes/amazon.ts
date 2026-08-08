import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError, z } from "zod";
import { registerApiRouteMount } from "../route-mounts.js";
import type { ApiContext } from "../http.js";

const AMAZON_BOOKS_PATH = "/hz/mycd/digital-console/contentlist/booksAll";

const AmazonItemSchema = z
  .object({
    asin: z.string().regex(/^[A-Z0-9]{10}$/),
    title: z.string().trim().min(1).max(2000),
    author: z.string().max(2000),
    acquiredLabel: z.string().max(200),
    isRental: z.boolean(),
    isRead: z.boolean(),
  })
  .strict();

const AmazonImportRequestSchema = z
  .object({
    pageUrl: z.string().url(),
    items: z.array(AmazonItemSchema).max(100),
  })
  .strict();

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

function parseZod<T>(schema: { parse: (value: unknown) => T }, value: unknown): T | null {
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

function isAmazonBooksPageUrl(pageUrl: string): boolean {
  try {
    const url = new URL(pageUrl);
    const pageNumber = url.searchParams.get("pageNumber");
    return (
      url.protocol === "https:" &&
      url.hostname === "www.amazon.co.jp" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === "" &&
      (url.pathname === AMAZON_BOOKS_PATH || url.pathname.startsWith(`${AMAZON_BOOKS_PATH}/`)) &&
      (pageNumber === null || /^[1-9]\d*$/.test(pageNumber))
    );
  } catch {
    return false;
  }
}

async function handleAmazonRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
  url: URL,
): Promise<boolean> {
  if (req.method !== "POST" || url.pathname !== "/api/import/amazon") return false;

  const raw = await readBody(req);
  let body: unknown;
  try {
    body = raw.length ? JSON.parse(raw) : null;
  } catch {
    validationError(res);
    return true;
  }
  const parsed = parseZod(AmazonImportRequestSchema, body);
  if (!parsed || !isAmazonBooksPageUrl(parsed.pageUrl)) {
    validationError(res);
    return true;
  }

  const items = [...new Map(parsed.items.map((item) => [item.asin, item])).values()];
  const observedAt = new Date().toISOString();
  const statement = ctx.db.prepare(
    `INSERT INTO amazon_observation
       (asin, title, author, acquired_label, state, is_read, page_url, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(asin) DO UPDATE SET
       title = excluded.title,
       author = excluded.author,
       acquired_label = excluded.acquired_label,
       state = excluded.state,
       is_read = excluded.is_read,
       page_url = excluded.page_url,
       observed_at = excluded.observed_at`,
  );

  try {
    ctx.db.exec("BEGIN");
    for (const item of items) {
      statement.run(
        item.asin,
        item.title,
        item.author,
        item.acquiredLabel,
        item.isRental ? "rental" : "acquired_or_unknown",
        item.isRead ? 1 : 0,
        parsed.pageUrl,
        observedAt,
      );
    }
    ctx.db.exec("COMMIT");
  } catch {
    try {
      ctx.db.exec("ROLLBACK");
    } catch {
      // Preserve the stable validation-shaped response at this local boundary.
    }
    validationError(res);
    return true;
  }

  const rentals = items.filter((item) => item.isRental).length;
  json(res, 200, {
    observed: items.length,
    stored: items.length,
    acquiredOrUnknown: items.length - rentals,
    rentals,
  });
  return true;
}

registerApiRouteMount(handleAmazonRoute);
