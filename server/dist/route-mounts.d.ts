import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiContext } from "./http.js";
/** Handler invoked for /api/* after shared guards; return true when handled. */
export type ApiRouteMount = (req: IncomingMessage, res: ServerResponse, ctx: ApiContext, url: URL) => Promise<boolean>;
/** Mount point for T-ADMIN-* and future route splits (spec scope-delta §4.2). */
export declare function registerApiRouteMount(mount: ApiRouteMount): void;
export declare function dispatchRouteMounts(req: IncomingMessage, res: ServerResponse, ctx: ApiContext, url: URL): Promise<boolean>;
//# sourceMappingURL=route-mounts.d.ts.map