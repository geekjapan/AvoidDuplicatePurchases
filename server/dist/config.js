const DEFAULT_PORT = 41321;
const DEFAULT_HOST = "127.0.0.1";
export function loadConfig(env = process.env) {
    const port = Number(env.ADP_PORT ?? DEFAULT_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("invalid ADP_PORT");
    }
    const dbPath = env.ADP_DB_PATH ?? joinDefaultDbPath();
    const extensionOrigins = new Set();
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
function joinDefaultDbPath() {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
    return `${home}/.adp/data.sqlite`;
}
/** Check whether a browser Origin header is allowed (spec §7). */
export function isAllowedOrigin(origin, port) {
    if (!origin)
        return true;
    if (origin.startsWith("chrome-extension://"))
        return true;
    const allowed = new Set([
        `http://127.0.0.1:${port}`,
        `http://localhost:${port}`,
    ]);
    return allowed.has(origin);
}
//# sourceMappingURL=config.js.map