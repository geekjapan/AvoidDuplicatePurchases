import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute } from "node:path";
import { ZodError, z } from "zod";
import { registerApiRouteMount } from "../route-mounts.js";
import type { ApiContext } from "../http.js";
import type { DatabaseSync } from "node:sqlite";

const SETTINGS_SOURCE_KEY = "__admin_settings__";

const SettingsResponseSchema = z.object({
  port: z.number().int().min(1).max(65535),
  exportDestination: z.string(),
});

const SettingsRequestSchema = z
  .object({
    port: z.number().int().min(1).max(65535),
    exportDestination: z
      .string()
      .min(1)
      .refine((value) => isAbsolute(value.trim()), {
        message: "exportDestination must be an absolute path",
      }),
  })
  .strict();

export type AdminSettings = z.infer<typeof SettingsResponseSchema>;

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

function defaultSettings(port: number): AdminSettings {
  return { port, exportDestination: "" };
}

function readPersistedSettings(db: DatabaseSync): Partial<AdminSettings> | null {
  const row = db
    .prepare("SELECT cursor FROM sync_state WHERE source = ?")
    .get(SETTINGS_SOURCE_KEY) as { cursor: string | null } | undefined;
  if (!row?.cursor) return null;
  try {
    const parsed = JSON.parse(row.cursor) as {
      port?: unknown;
      exportDestination?: unknown;
    };
    const out: Partial<AdminSettings> = {};
    if (typeof parsed.port === "number" && Number.isInteger(parsed.port)) {
      out.port = parsed.port;
    }
    if (typeof parsed.exportDestination === "string") {
      out.exportDestination = parsed.exportDestination;
    }
    return out;
  } catch {
    return null;
  }
}

export function loadAdminSettings(db: DatabaseSync, runtimePort: number): AdminSettings {
  const defaults = defaultSettings(runtimePort);
  const persisted = readPersistedSettings(db);
  if (!persisted) return defaults;
  return SettingsResponseSchema.parse({
    port: persisted.port ?? defaults.port,
    exportDestination: persisted.exportDestination ?? defaults.exportDestination,
  });
}

export function persistAdminSettings(db: DatabaseSync, settings: AdminSettings, now: string): void {
  const payload = JSON.stringify({
    port: settings.port,
    exportDestination: settings.exportDestination,
  });
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO sync_state (source, cursor, last_synced_at) VALUES (?, ?, ?)
       ON CONFLICT(source) DO UPDATE SET
         cursor = excluded.cursor,
         last_synced_at = excluded.last_synced_at`,
    ).run(SETTINGS_SOURCE_KEY, payload, now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function handleSettingsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
  url: URL,
): Promise<boolean> {
  if (url.pathname !== "/api/settings") return false;
  const method = req.method ?? "GET";

  if (method === "GET") {
    const settings = loadAdminSettings(ctx.db, ctx.port);
    json(res, 200, SettingsResponseSchema.parse(settings));
    return true;
  }

  if (method === "POST") {
    const raw = await readBody(req);
    let body: unknown;
    try {
      body = raw.length ? JSON.parse(raw) : null;
    } catch {
      validationError(res);
      return true;
    }
    const parsed = parseZod(SettingsRequestSchema, body);
    if (!parsed) {
      validationError(res);
      return true;
    }
    const settings = SettingsResponseSchema.parse({
      port: parsed.port,
      exportDestination: parsed.exportDestination.trim(),
    });
    persistAdminSettings(ctx.db, settings, new Date().toISOString());
    json(res, 200, settings);
    return true;
  }

  return false;
}

/** Register GET/POST /api/settings (T-ADMIN-OPS). */
export function registerSettingsRoutes(): void {
  registerApiRouteMount(handleSettingsRoute);
}

registerSettingsRoutes();
