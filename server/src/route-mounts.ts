import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiContext } from "./http.js";

/** Handler invoked for /api/* after shared guards; return true when handled. */
export type ApiRouteMount = (
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
  url: URL,
) => Promise<boolean>;

const mounts: ApiRouteMount[] = [];

/** Mount point for T-ADMIN-* and future route splits (spec scope-delta §4.2). */
export function registerApiRouteMount(mount: ApiRouteMount): void {
  mounts.push(mount);
}

export async function dispatchRouteMounts(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ApiContext,
  url: URL,
): Promise<boolean> {
  for (const mount of mounts) {
    if (await mount(req, res, ctx, url)) return true;
  }
  return false;
}
