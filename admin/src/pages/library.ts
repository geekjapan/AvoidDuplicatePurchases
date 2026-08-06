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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function renderLibrary(root: HTMLElement): Promise<void> {
  root.replaceChildren(el("div", { className: "panel" }, [
    el("h2", { textContent: "ライブラリ" }),
    el("p", { className: "muted", textContent: "タイトル・メーカー・ソースで検索し、正規 work 単位で表示します。" }),
  ]));

  const filters = el("div", { className: "filters" });

  const qLabel = el("label", { for: "filter-q", textContent: "タイトル検索" });
  const qInput = el("input", {
    id: "filter-q",
    type: "search",
    placeholder: "検索（タイトル・メーカー・ソース）",
    "data-testid": "filter-q",
    "aria-label": "タイトル検索",
  });

  const sourceLabel = el("label", { for: "filter-source", textContent: "ソース" });
  const sourceSelect = el("select", {
    id: "filter-source",
    "data-testid": "filter-source",
    "aria-label": "ソース",
  });
  sourceSelect.append(el("option", { value: "", textContent: "全ソース" }));
  for (const source of SOURCES) {
    sourceSelect.append(el("option", { value: source, textContent: source }));
  }

  const makerLabel = el("label", { for: "filter-maker", textContent: "メーカー" });
  const makerInput = el("input", {
    id: "filter-maker",
    type: "search",
    placeholder: "メーカー（正規化一致）",
    "data-testid": "filter-maker",
    "aria-label": "メーカー",
  });

  const searchBtn = el("button", {
    className: "primary",
    textContent: "検索",
    "data-testid": "search-btn",
  });
  filters.append(
    qLabel,
    qInput,
    sourceLabel,
    sourceSelect,
    makerLabel,
    makerInput,
    searchBtn,
  );

  const statusRegion = el("div", {
    className: "status-region",
    role: "status",
    "aria-live": "polite",
    "aria-atomic": "true",
    "data-testid": "library-status",
  });
  const listHost = el("div", { "data-testid": "library-list" });
  root.append(filters, statusRegion, listHost);

  const selected = new Set<number>();
  /** True while a load or mutation is in flight. */
  let pending = false;
  /**
   * Monotonic generation for list loads. A completed older request whose
   * generation no longer matches must not overwrite a newer response.
   */
  let loadGeneration = 0;
  let mergeBtn: HTMLButtonElement | null = null;
  const splitButtons = new Set<HTMLButtonElement>();

  function setStatus(message: string, kind: "info" | "success" | "error" = "info"): void {
    statusRegion.textContent = message;
    statusRegion.className = `status-region status-${kind}`;
    statusRegion.setAttribute("data-kind", kind);
    if (kind === "error") {
      statusRegion.setAttribute("role", "alert");
      statusRegion.setAttribute("aria-live", "assertive");
    } else {
      statusRegion.setAttribute("role", "status");
      statusRegion.setAttribute("aria-live", "polite");
    }
  }

  function clearStatus(): void {
    statusRegion.textContent = "";
    statusRegion.className = "status-region";
    statusRegion.removeAttribute("data-kind");
    statusRegion.setAttribute("role", "status");
    statusRegion.setAttribute("aria-live", "polite");
  }

  /** Disable search/filter/mutation controls to prevent overlapping submission. */
  function setControlsDisabled(disabled: boolean): void {
    searchBtn.disabled = disabled;
    qInput.disabled = disabled;
    sourceSelect.disabled = disabled;
    makerInput.disabled = disabled;
    if (mergeBtn) mergeBtn.disabled = disabled;
    for (const btn of splitButtons) btn.disabled = disabled;
  }

  /**
   * Every load (initial + search + post-mutation reload) shares the same
   * pending / disable / error / finally discipline. Stale generations never
   * apply DOM updates or restore controls out from under a newer load.
   */
  async function load(): Promise<void> {
    const generation = ++loadGeneration;
    pending = true;
    setControlsDisabled(true);
    listHost.replaceChildren(el("p", { className: "muted", textContent: "読み込み中…" }));
    mergeBtn = null;
    splitButtons.clear();
    try {
      const q = qInput.value.trim();
      const source = sourceSelect.value;
      const maker = makerInput.value.trim();
      const data = await fetchListings({
        q: q || undefined,
        source: source || undefined,
        maker: maker || undefined,
      });
      if (generation !== loadGeneration) return;
      renderListings(data.listings);
    } catch (err) {
      if (generation !== loadGeneration) return;
      listHost.replaceChildren();
      setStatus(errorMessage(err), "error");
    } finally {
      if (generation === loadGeneration) {
        pending = false;
        setControlsDisabled(false);
      }
    }
  }

  function renderListings(listings: Listing[]): void {
    listHost.replaceChildren();
    mergeBtn = null;
    splitButtons.clear();
    if (listings.length === 0) {
      listHost.append(el("p", { className: "empty", textContent: "該当する listing がありません。" }));
      return;
    }

    const actions = el("div", { className: "filters" });
    const nextMergeBtn = el("button", {
      className: "primary",
      textContent: "選択を結合",
      "data-testid": "merge-btn",
    });
    mergeBtn = nextMergeBtn;
    nextMergeBtn.addEventListener("click", () => {
      void (async () => {
        if (pending) return;
        const picked = listings.filter((l) => selected.has(l.id));
        if (picked.length < 2) {
          setStatus("結合するには2件以上選択してください。", "error");
          return;
        }
        pending = true;
        setControlsDisabled(true);
        clearStatus();
        try {
          // Explicit merge onto the lowest existing work among the selection.
          const targetWorkId = Math.min(...picked.map((l) => l.workId));
          for (const listing of picked) {
            await assignWork(listing.source, listing.cid, {
              workId: targetWorkId,
              lock: true,
            });
          }
          selected.clear();
          setStatus("選択した listing を結合しました。", "success");
          // load() re-applies pending/disable and owns the final restore.
          await load();
        } catch (err) {
          setStatus(errorMessage(err), "error");
          pending = false;
          setControlsDisabled(false);
        }
      })();
    });
    actions.append(nextMergeBtn);
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
        const accessibleName = `選択: ${listing.title}（${listing.source} / ${listing.cid}）`;
        const checkbox = el("input", {
          type: "checkbox",
          "data-testid": `select-${listing.cid}`,
          "aria-label": accessibleName,
        });
        checkbox.checked = selected.has(listing.id);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selected.add(listing.id);
          else selected.delete(listing.id);
        });
        const splitAccessibleName = `分離: ${listing.title}（${listing.source} / ${listing.cid}）`;
        const splitBtn = el("button", {
          textContent: "分離",
          "data-testid": `split-${listing.cid}`,
          "aria-label": splitAccessibleName,
        });
        splitButtons.add(splitBtn);
        splitBtn.addEventListener("click", () => {
          void (async () => {
            if (pending) return;
            pending = true;
            setControlsDisabled(true);
            clearStatus();
            try {
              // Server allocates a fresh work id transactionally; client never invents one.
              await assignWork(listing.source, listing.cid, {
                allocateNew: true,
                lock: true,
              });
              setStatus("listing を分離しました。", "success");
              await load();
            } catch (err) {
              setStatus(errorMessage(err), "error");
              pending = false;
              setControlsDisabled(false);
            }
          })();
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

  searchBtn.addEventListener("click", () => {
    // Disabled controls block user double-submit (incl. synthetic events).
    // If a programmatic caller re-enables and overlaps, loadGeneration drops
    // the stale response so older completions never overwrite newer ones.
    if (searchBtn.disabled) return;
    clearStatus();
    void load();
  });

  // Initial load uses the same pending/error/finally discipline as every load.
  await load();
}
