export interface ServerConfig {
    host: string;
    port: number;
    dbPath: string;
    extensionOrigins: Set<string>;
}
export declare function loadConfig(env?: Record<string, string | undefined>): ServerConfig;
/** Check whether a browser Origin header is allowed (spec §7). */
export declare function isAllowedOrigin(origin: string | undefined, port: number): boolean;
//# sourceMappingURL=config.d.ts.map