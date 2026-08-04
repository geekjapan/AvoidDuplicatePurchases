import { renderCandidates } from "./pages/candidates.js";
import { renderLibrary } from "./pages/library.js";

export type AdminRoute = "library" | "candidates";

const routes: Record<AdminRoute, (root: HTMLElement) => Promise<void>> = {
  library: renderLibrary,
  candidates: renderCandidates,
};

export function parseRoute(pathname: string): AdminRoute {
  if (pathname.startsWith("/candidates")) return "candidates";
  return "library";
}

export function routePath(route: AdminRoute): string {
  return route === "candidates" ? "/candidates" : "/";
}

export async function renderRoute(route: AdminRoute, root: HTMLElement): Promise<void> {
  await routes[route](root);
}

export function allRoutes(): AdminRoute[] {
  return ["library", "candidates"];
}
