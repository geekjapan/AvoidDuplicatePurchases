import { MSG_LIBRARY_SYNC, MSG_SERVER_STATUS, MSG_SYNC } from "../messages.js";
import { refreshSyncStatus, renderSyncStatus } from "./sync-status.js";
import type { FullSyncOutcome } from "../alarms.js";

/** User-triggered library-sync entry points for the three DOM providers. */
const LIBRARY_BUTTONS = [
  { id: "lib-sync-amazon", source: "amazon", label: "Amazon Kindle" },
  { id: "lib-sync-ebookjapan", source: "ebookjapan", label: "ebookjapan" },
  { id: "lib-sync-kobo", source: "kobo", label: "Kobo" },
] as const;

/** Local-only error reporting: codes never leave this machine's popup. */
const LIBRARY_ERROR_MESSAGES: Record<string, string> = {
  library_unknown_provider: "未対応のプロバイダです",
  library_no_tab: "同期に使うタブを開けませんでした",
  library_read_failed: "ライブラリ画面の読み取りに失敗しました",
  library_readiness_timeout: "ライブラリ画面の準備が完了しませんでした",
  library_login_required: "ログインが必要です（ライブラリ画面に到達できませんでした）",
  library_reader_unregistered: "ライブラリ読み取り機能が未登録です",
  library_batch_too_large: "1ページの件数が上限を超えました",
  network: "ローカルサーバーに接続できません",
};

export function librarySyncError(error: string | undefined): string {
  if (!error) return "同期に失敗しました";
  return LIBRARY_ERROR_MESSAGES[error] ?? error;
}

/** Map a thrown chrome.runtime transport failure to a local popup message. */
export function transportFailureMessage(label: string): string {
  return `${label} 同期失敗: ${librarySyncError("network")}`;
}

function bootPopup(): void {
  const statusEl = document.getElementById("server-status");
  const resultEl = document.getElementById("sync-result");
  const syncBtn = document.getElementById("sync-btn") as HTMLButtonElement | null;

  async function refreshStatus(): Promise<void> {
    if (!statusEl) return;
    try {
      const reply = (await chrome.runtime.sendMessage({ type: MSG_SERVER_STATUS })) as {
        connected?: boolean;
      };
      const connected = reply?.connected === true;
      statusEl.textContent = connected ? "サーバー: 接続済み" : "サーバー: 未接続";
      statusEl.className = connected ? "status connected" : "status disconnected";
    } catch {
      statusEl.textContent = "サーバー: 未接続";
      statusEl.className = "status disconnected";
    }
  }

  async function runLibrarySync(
    source: string,
    label: string,
    button: HTMLButtonElement,
  ): Promise<void> {
    if (resultEl) resultEl.textContent = `${label} 同期中…（ライブラリのタブを操作します）`;
    button.disabled = true;
    try {
      const reply = (await chrome.runtime.sendMessage({
        type: MSG_LIBRARY_SYNC,
        source,
      })) as {
        ok?: boolean;
        outcome?: {
          ok: boolean;
          pages?: number;
          observed?: number;
          inserted?: number;
          updated?: number;
          error?: string;
        };
      };
      if (!resultEl) return;
      const outcome = reply?.outcome;
      if (outcome?.ok) {
        resultEl.textContent =
          `${label} 同期完了: ${outcome.pages ?? 0}ページ / ${outcome.observed ?? 0}件` +
          `（新規 ${outcome.inserted ?? 0} / 更新 ${outcome.updated ?? 0}）`;
      } else {
        resultEl.textContent = `${label} 同期失敗: ${librarySyncError(outcome?.error)}`;
      }
    } catch {
      // chrome.runtime.sendMessage can reject (no receiver / invalidated
      // context). Surface a local error and let finally restore the button.
      if (resultEl) resultEl.textContent = transportFailureMessage(label);
    } finally {
      button.disabled = false;
      await refreshStatus();
    }
  }

  for (const entry of LIBRARY_BUTTONS) {
    const button = document.getElementById(entry.id) as HTMLButtonElement | null;
    if (!button) continue;
    button.addEventListener("click", () => runLibrarySync(entry.source, entry.label, button));
  }

  if (syncBtn) {
    syncBtn.textContent = "全ソース同期";
    syncBtn.addEventListener("click", async () => {
      if (resultEl) resultEl.textContent = "同期中…";
      syncBtn.disabled = true;
      try {
        const reply = (await chrome.runtime.sendMessage({ type: MSG_SYNC })) as {
          ok?: boolean;
          outcome?: {
            ok: boolean;
            sources?: Record<string, unknown>;
            error?: string;
          };
        };
        if (!resultEl) return;
        const outcome = reply?.outcome;
        if (outcome?.sources) {
          // Always render per-source rows and surface full-sync global error together.
          await renderSyncStatus(
            resultEl,
            outcome.sources as FullSyncOutcome["sources"],
            outcome.error ?? null,
          );
        } else if (outcome?.error) {
          resultEl.textContent = `エラー: ${outcome.error}`;
          await refreshSyncStatus(resultEl);
        } else {
          resultEl.textContent = "同期に失敗しました";
          await refreshSyncStatus(resultEl);
        }
      } catch {
        if (resultEl) resultEl.textContent = transportFailureMessage("全ソース");
      } finally {
        syncBtn.disabled = false;
        await refreshStatus();
      }
    });
  }

  void refreshStatus();
  if (resultEl) {
    void refreshSyncStatus(resultEl);
  }
}

// Browser popup entry: skip DOM boot under node:test imports.
if (typeof document !== "undefined") {
  bootPopup();
}
