import { SOURCES } from "@adp/shared";
import {
  assignWork,
  fetchListings,
  type Listing,
} from "../api.js";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "className") node.className = value;
    else if (key === "textContent") node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

function groupByWork(listings: Listing[]): Map<number, Listing[]> {
  const map = new Map<number, Listing[]>();
  for (const listing of listings) {
    const group = map.get(listing.workId) ?? [];
    group.push(listing);
    map.set(listing.workId, group);
  }
  return map;
}

export async function renderLibrary(root: HTMLElement): Promise<void> {
  root.replaceChildren(el("div", { className: "panel" }, [
    el("h2", { textContent: "ライブラリ" }),
    el("p", { className: "muted", textContent: "タイトル・メーカー・ソースで検索し、正規 work 単位で表示します。" }),
  ]));

  const filters = el("div", { className: "filters" });
  const qInput = el("input", {
    type: "search",
    placeholder: "検索（タイトル・メーカー・ソース）",
    "data-testid": "filter-q",
  });
  const sourceSelect = el("select", { "data-testid": "filter-source" });
  sourceSelect.append(el("option", { value: "", textContent: "全ソース" }));
  for (const source of SOURCES) {
    sourceSelect.append(el("option", { value: source, textContent: source }));
  }
  const makerInput = el("input", {
    type: "search",
    placeholder: "メーカー（正規化一致）",
    "data-testid": "filter-maker",
  });
  const searchBtn = el("button", {
    className: "primary",
    textContent: "検索",
    "data-testid": "search-btn",
  });
  filters.append(qInput, sourceSelect, makerInput, searchBtn);

  const listHost = el("div", { "data-testid": "library-list" });
  root.append(filters, listHost);

  const selected = new Set<number>();

  async function load(): Promise<void> {
    listHost.replaceChildren(el("p", { className: "muted", textContent: "読み込み中…" }));
    const q = qInput.value.trim();
    const source = sourceSelect.value;
    const maker = makerInput.value.trim();
    const data = await fetchListings({
      q: q || undefined,
      source: source || undefined,
      maker: maker || undefined,
    });
    renderListings(data.listings);
  }

  function renderListings(listings: Listing[]): void {
    listHost.replaceChildren();
    if (listings.length === 0) {
      listHost.append(el("p", { className: "empty", textContent: "該当する listing がありません。" }));
      return;
    }

    const actions = el("div", { className: "filters" });
    const mergeBtn = el("button", {
      className: "primary",
      textContent: "選択を結合",
      "data-testid": "merge-btn",
    });
    mergeBtn.addEventListener("click", async () => {
      const picked = listings.filter((l) => selected.has(l.id));
      if (picked.length < 2) return;
      // Explicit merge onto the lowest existing work among the selection.
      const targetWorkId = Math.min(...picked.map((l) => l.workId));
      for (const listing of picked) {
        await assignWork(listing.source, listing.cid, {
          workId: targetWorkId,
          lock: true,
        });
      }
      selected.clear();
      await load();
    });
    actions.append(mergeBtn);
    listHost.append(actions);

    const groups = groupByWork(listings);
    for (const [workId, items] of groups) {
      const group = el("section", {
        className: "work-group",
        "data-work-id": String(workId),
      });
      group.append(
        el("header", { textContent: `work #${workId}（${items.length} 件）` }),
      );
      for (const listing of items) {
        const checkbox = el("input", {
          type: "checkbox",
          "data-testid": `select-${listing.cid}`,
        });
        checkbox.checked = selected.has(listing.id);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selected.add(listing.id);
          else selected.delete(listing.id);
        });
        const splitBtn = el("button", {
          textContent: "分離",
          "data-testid": `split-${listing.cid}`,
        });
        splitBtn.addEventListener("click", async () => {
          // Server allocates a fresh work id transactionally; client never invents one.
          await assignWork(listing.source, listing.cid, {
            allocateNew: true,
            lock: true,
          });
          await load();
        });
        const row = el("div", {
          className: `listing-row${listing.workIdLocked ? " locked" : ""}`,
          "data-cid": listing.cid,
          "data-work-id": String(listing.workId),
        });
        row.append(
          checkbox,
          el("div", {}, [
            el("strong", { textContent: listing.title }),
            el("div", { className: "muted", textContent: `${listing.source} / ${listing.cid}` }),
            listing.maker
              ? el("div", { className: "muted", textContent: listing.maker })
              : document.createComment(""),
          ]),
          listing.workIdLocked
            ? el("span", { className: "muted", textContent: "locked" })
            : document.createComment(""),
          splitBtn,
        );
        group.append(row);
      }
      listHost.append(group);
    }
  }

  searchBtn.addEventListener("click", () => load());
  await load();
}
