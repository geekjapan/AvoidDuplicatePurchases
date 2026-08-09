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
  library_page_url_invalid: "ライブラリページのURLが不正です",
  library_max_pages_exceeded: "ページ数が上限を超えました",
  library_invalid_poll_config: "ライブラリ同期の待機設定が不正です",
  library_rematch_failed: "蔵書の再突合に失敗しました",
  library_mark_synced_failed: "同期完了の記録に失敗しました",
  protocol: "サーバー応答の形式が不正です",
  network: "ローカルサーバーに接続できません",
};

const GENERIC_LIBRARY_SYNC_FAILURE = "同期に失敗しました";

export function librarySyncError(error: string | undefined): string {
  if (!error) return GENERIC_LIBRARY_SYNC_FAILURE;
  // Fail-closed: never surface raw internal codes to the popup UI.
  return LIBRARY_ERROR_MESSAGES[error] ?? GENERIC_LIBRARY_SYNC_FAILURE;
}

/** Map a thrown chrome.runtime transport failure to a local popup message. */
export function transportFailureMessage(label: string): string {
  return `${label} 同期失敗: ${librarySyncError("network")}`;
}

export interface SyncControl {
  disabled: boolean;
}

/** Serialize all popup sync actions and keep their controls in one state. */
export function createSyncControlGate(controls: SyncControl[]) {
  let inFlight = false;
  return {
    tryStart(): boolean {
      if (inFlight) return false;
      inFlight = true;
      for (const control of controls) control.disabled = true;
      return true;
    },
    release(): void {
      inFlight = false;
      for (const control of controls) control.disabled = false;
    },
  };
}

function bootPopup(): void {
  const statusEl = document.getElementById("server-status");
  const resultEl = document.getElementById("sync-result");
  const syncBtn = document.getElementById("sync-btn") as HTMLButtonElement | null;
  const libraryButtonEntries = LIBRARY_BUTTONS.flatMap((entry) => {
    const button = document.getElementById(entry.id) as HTMLButtonElement | null;
    return button ? [{ entry, button }] : [];
  });
  const syncControls: SyncControl[] = [
    ...(syncBtn ? [syncBtn] : []),
    ...libraryButtonEntries.map(({ button }) => button),
  ];
  const syncGate = createSyncControlGate(syncControls);

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
  ): Promise<void> {
    if (!syncGate.tryStart()) return;
    if (resultEl) resultEl.textContent = `${label} 同期中…（ライブラリのタブを操作します）`;
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
      try {
        await refreshStatus();
      } finally {
        syncGate.release();
      }
    }
  }

  for (const { entry, button } of libraryButtonEntries) {
    button.addEventListener("click", () => {
      void runLibrarySync(entry.source, entry.label);
    });
  }

  if (syncBtn) {
    syncBtn.textContent = "全ソース同期";
    syncBtn.addEventListener("click", async () => {
      if (!syncGate.tryStart()) return;
      if (resultEl) resultEl.textContent = "同期中…";
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
        try {
          await refreshStatus();
        } finally {
          syncGate.release();
        }
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
