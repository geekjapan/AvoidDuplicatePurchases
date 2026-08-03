const DEFAULT_PORT = 41321;
const DEFAULT_HOST = "127.0.0.1";

export interface ServerConfig {
  host: string;
  port: number;
  dbPath: string;
  extensionOrigins: Set<string>;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const port = Number(env.ADP_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("invalid ADP_PORT");
  }
  const dbPath = env.ADP_DB_PATH ?? joinDefaultDbPath();
  const extensionOrigins = new Set<string>();
  if (env.ADP_EXTENSION_ORIGIN) {
    extensionOrigins.add(env.ADP_EXTENSION_ORIGIN);
  }
  return {
    host: DEFAULT_HOST,
    port,
    dbPath,
    extensionOrigins,
  };
}

function joinDefaultDbPath(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
  return `${home}/.adp/data.sqlite`;
}

/** Check whether a browser Origin header is allowed (spec §7). */
export function isAllowedOrigin(origin: string | undefined, port: number): boolean {
  if (!origin) return true;
  if (origin.startsWith("chrome-extension://")) return true;
  const allowed = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ]);
  return allowed.has(origin);
}
