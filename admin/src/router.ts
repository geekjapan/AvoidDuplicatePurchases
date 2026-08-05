import { renderCandidates } from "./pages/candidates.js";
import { renderLibrary } from "./pages/library.js";
import { renderSync } from "./pages/sync/sync.js";
import { renderSettings } from "./pages/settings/settings.js";

export type AdminRoute = "library" | "candidates" | "sync" | "settings";

const routes: Record<AdminRoute, (root: HTMLElement) => Promise<void>> = {
  library: renderLibrary,
  candidates: renderCandidates,
  sync: renderSync,
  settings: renderSettings,
};

export function parseRoute(pathname: string): AdminRoute {
  if (pathname.startsWith("/candidates")) return "candidates";
  if (pathname.startsWith("/sync")) return "sync";
  if (pathname.startsWith("/settings")) return "settings";
  return "library";
}

export function routePath(route: AdminRoute): string {
  switch (route) {
    case "candidates":
      return "/candidates";
    case "sync":
      return "/sync";
    case "settings":
      return "/settings";
    default:
      return "/";
  }
}

export async function renderRoute(route: AdminRoute, root: HTMLElement): Promise<void> {
  await routes[route](root);
}

export function allRoutes(): AdminRoute[] {
  return ["library", "candidates", "sync", "settings"];
}
