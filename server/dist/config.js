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
        for (const part of env.ADP_EXTENSION_ORIGIN.split(",")) {
            const origin = part.trim();
            if (origin)
                extensionOrigins.add(origin);
        }
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
/**
 * Check whether a browser Origin header is allowed (spec §7).
 * chrome-extension:// origins must be exact members of the configured allowlist.
 */
export function isAllowedOrigin(origin, port, extensionOrigins = new Set()) {
    if (!origin)
        return true;
    const allowedLocal = new Set([
        `http://127.0.0.1:${port}`,
        `http://localhost:${port}`,
    ]);
    if (allowedLocal.has(origin))
        return true;
    if (origin.startsWith("chrome-extension://")) {
        return extensionOrigins.has(origin);
    }
    return false;
}
//# sourceMappingURL=config.js.map