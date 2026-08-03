const mounts = [];
/** Mount point for T-ADMIN-* and future route splits (spec scope-delta §4.2). */
export function registerApiRouteMount(mount) {
    mounts.push(mount);
}
export async function dispatchRouteMounts(req, res, ctx, url) {
    for (const mount of mounts) {
        if (await mount(req, res, ctx, url))
            return true;
    }
    return false;
}
//# sourceMappingURL=route-mounts.js.map