import { allRoutes, parseRoute, renderRoute, routePath, type AdminRoute } from "./router.js";

const app = document.getElementById("app");
if (!app) throw new Error("missing #app");

const header = document.createElement("header");
const title = document.createElement("h1");
title.textContent = "ADP 管理";
const nav = document.createElement("nav");
header.append(title, nav);

const main = document.createElement("main");
app.append(header, main);

const links: Record<AdminRoute, HTMLAnchorElement> = {
  library: document.createElement("a"),
  related: document.createElement("a"),
  candidates: document.createElement("a"),
  sync: document.createElement("a"),
  settings: document.createElement("a"),
};

links.library.href = routePath("library");
links.library.textContent = "ライブラリ";
links.related.href = routePath("related");
links.related.textContent = "関連比較";
links.candidates.href = routePath("candidates");
links.candidates.textContent = "候補キュー";
links.sync.href = routePath("sync");
links.sync.textContent = "同期";
links.settings.href = routePath("settings");
links.settings.textContent = "設定";
nav.append(
  links.library,
  links.related,
  links.candidates,
  links.sync,
  links.settings,
);

function setActive(route: AdminRoute): void {
  for (const key of allRoutes()) {
    links[key].classList.toggle("active", key === route);
  }
}

function showShellError(err: unknown): void {
  main.replaceChildren();
  const errorEl = document.createElement("div");
  errorEl.className = "status-region status-error";
  errorEl.setAttribute("role", "alert");
  errorEl.setAttribute("aria-live", "assertive");
  errorEl.setAttribute("aria-atomic", "true");
  errorEl.setAttribute("data-testid", "shell-error");
  errorEl.textContent = err instanceof Error ? err.message : String(err);
  main.append(errorEl);
}

async function navigate(): Promise<void> {
  try {
    const route = parseRoute(window.location.pathname);
    setActive(route);
    main.replaceChildren();
    const pageRoot = document.createElement("div");
    main.append(pageRoot);
    await renderRoute(route, pageRoot);
  } catch (err) {
    showShellError(err);
  }
}

window.addEventListener("popstate", () => {
  void navigate();
});
nav.addEventListener("click", (event) => {
  const raw = event.target;
  if (!(raw instanceof Node)) return;
  const anchor =
    raw instanceof HTMLAnchorElement
      ? raw
      : raw.parentElement instanceof HTMLAnchorElement
        ? raw.parentElement
        : null;
  if (!anchor) return;
  if (anchor.origin !== window.location.origin) return;
  event.preventDefault();
  window.history.pushState(null, "", anchor.pathname);
  void navigate();
});

void navigate();
