import { SOURCES } from "@adp/shared";

const SOURCE_LABELS: Record<string, string> = {
  dlsite: "DLsite",
  fanza_doujin: "FANZA 同人",
  fanza_books: "FANZA ブックス",
  fanza_video: "FANZA 動画",
  fanza_dlsoft: "FANZA PCゲーム",
  full_sync: "全体同期",
};

interface SyncOutcome {
  ok: boolean;
  counts?: { inserted: number; updated: number };
  error?: string | null;
  fetched?: number | null;
  recordedAt?: string;
}

interface SyncState {
  cursor: string | null;
  lastSyncedAt: string | null;
  latestOutcome?: SyncOutcome | null;
}

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

function formatLastSynced(lastSyncedAt: string | null): string {
  if (!lastSyncedAt) return "未同期";
  try {
    return new Date(lastSyncedAt).toLocaleString("ja-JP");
  } catch {
    return lastSyncedAt;
  }
}

function formatOutcome(source: string, state: SyncState | null): string {
  const label = SOURCE_LABELS[source] ?? source;
  const last = formatLastSynced(state?.lastSyncedAt ?? null);
  const latest = state?.latestOutcome;
  if (!latest) {
    return `${label}: 最終 ${last}`;
  }
  if (latest.ok && latest.counts) {
    const fetched = latest.fetched ?? "?";
    return `${label}: 取得 ${fetched} ページ / 新規 ${latest.counts.inserted} / 更新 ${latest.counts.updated}（${last}）`;
  }
  if (latest.error) {
    const counts = latest.counts
      ? ` / 新規 ${latest.counts.inserted} / 更新 ${latest.counts.updated}`
      : "";
    return `${label}: エラー ${latest.error}${counts}（${last}）`;
  }
  return `${label}: 失敗（${last}）`;
}

async function fetchSyncState(source: string): Promise<SyncState> {
  const res = await fetch(`/api/sync-state/${encodeURIComponent(source)}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`同期状態の取得に失敗しました (${source}): ${text}`);
  return JSON.parse(text) as SyncState;
}

async function postRematch(): Promise<{ rematched: number; candidates: number }> {
  const res = await fetch("/api/rematch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`再照合に失敗しました: ${text}`);
  return JSON.parse(text) as { rematched: number; candidates: number };
}

async function postManualListing(url: string): Promise<void> {
  const res = await fetch("/api/listings/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`手動登録に失敗しました: ${text}`);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function renderSync(root: HTMLElement): Promise<void> {
  root.replaceChildren(
    el("div", { className: "panel" }, [
      el("h2", { textContent: "同期" }),
      el("p", {
        className: "muted",
        textContent: "各ソースの最終同期状態を表示し、再照合と手動登録を行います。",
      }),
    ]),
  );

  const statusList = el("ul", {
    className: "sync-status-list",
    "data-testid": "sync-status-list",
    "aria-label": "同期状態一覧",
  });

  const statusRegion = el("div", {
    className: "status-region",
    role: "status",
    "aria-live": "polite",
    "aria-atomic": "true",
    "data-testid": "sync-status-region",
  });

  const rematchBtn = el("button", {
    className: "primary",
    textContent: "再照合を実行",
    "data-testid": "rematch-btn",
    "aria-label": "再照合を実行",
  });

  const manualForm = el("form", { className: "manual-form", "data-testid": "manual-form" });
  const urlLabel = el("label", { for: "manual-url", textContent: "商品 URL" });
  const urlInput = el("input", {
    id: "manual-url",
    type: "url",
    placeholder: "対応店舗の商品ページ URL",
    "data-testid": "manual-url",
    "aria-label": "商品 URL",
    required: "true",
  });
  const manualBtn = el("button", {
    type: "submit",
    className: "primary",
    textContent: "手動登録",
    "data-testid": "manual-submit",
    "aria-label": "手動登録",
  });
  manualForm.append(urlLabel, urlInput, manualBtn);

  const panel = el("div", { className: "panel" }, [statusList, rematchBtn, manualForm]);
  root.append(panel, statusRegion);

  let pending = false;

  function setPending(value: boolean): void {
    pending = value;
    rematchBtn.disabled = value;
    manualBtn.disabled = value;
    urlInput.disabled = value;
  }

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

  function renderRows(states: Record<string, SyncState | null>): void {
    statusList.replaceChildren();
    for (const source of [...SOURCES, "full_sync"]) {
      const line = formatOutcome(source, states[source] ?? null);
      const item = el("li", {
        textContent: line,
        "data-testid": `sync-row-${source}`,
        "aria-label": line,
      });
      statusList.append(item);
    }
  }

  async function loadStates(): Promise<void> {
    const keys = [...SOURCES, "full_sync"];
    const results = await Promise.all(
      keys.map(async (source) => {
        try {
          return [source, await fetchSyncState(source)] as const;
        } catch {
          return [source, null] as const;
        }
      }),
    );
    const map: Record<string, SyncState | null> = {};
    for (const [source, state] of results) {
      map[source] = state;
    }
    renderRows(map);
  }

  async function refresh(): Promise<void> {
    setPending(true);
    setStatus("同期状態を読み込み中…");
    try {
      await loadStates();
      setStatus("同期状態を更新しました", "success");
    } catch (err) {
      setStatus(errorMessage(err), "error");
    } finally {
      setPending(false);
    }
  }

  rematchBtn.addEventListener("click", () => {
    void (async () => {
      if (pending) return;
      setPending(true);
      setStatus("再照合を実行中…");
      try {
        const result = await postRematch();
        await loadStates();
        setStatus(
          `再照合完了: ${result.rematched} 件再割当 / 候補 ${result.candidates} 件`,
          "success",
        );
      } catch (err) {
        setStatus(errorMessage(err), "error");
      } finally {
        setPending(false);
      }
    })();
  });

  manualForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      if (pending) return;
      const url = urlInput.value.trim();
      if (!url) return;
      setPending(true);
      setStatus("手動登録中…");
      try {
        await postManualListing(url);
        urlInput.value = "";
        await loadStates();
        setStatus("手動登録が完了しました", "success");
      } catch (err) {
        setStatus(errorMessage(err), "error");
      } finally {
        setPending(false);
      }
    })();
  });

  await refresh();
}
