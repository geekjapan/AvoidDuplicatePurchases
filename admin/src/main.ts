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
  candidates: document.createElement("a"),
};

links.library.href = routePath("library");
links.library.textContent = "ライブラリ";
links.candidates.href = routePath("candidates");
links.candidates.textContent = "候補キュー";
nav.append(links.library, links.candidates);

function setActive(route: AdminRoute): void {
  for (const key of allRoutes()) {
    links[key].classList.toggle("active", key === route);
  }
}

async function navigate(): Promise<void> {
  const route = parseRoute(window.location.pathname);
  setActive(route);
  main.replaceChildren();
  const pageRoot = document.createElement("div");
  main.append(pageRoot);
  await renderRoute(route, pageRoot);
}

window.addEventListener("popstate", () => navigate());
nav.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLAnchorElement)) return;
  if (target.origin !== window.location.origin) return;
  event.preventDefault();
  window.history.pushState(null, "", target.pathname);
  navigate();
});

navigate();
