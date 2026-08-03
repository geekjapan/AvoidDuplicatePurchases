import { MSG_SERVER_STATUS, MSG_SYNC } from "../messages.js";
import { refreshSyncStatus, renderSyncStatus } from "./sync-status.js";
const statusEl = document.getElementById("server-status");
const resultEl = document.getElementById("sync-result");
const syncBtn = document.getElementById("sync-btn");
async function refreshStatus() {
    if (!statusEl)
        return;
    const reply = (await chrome.runtime.sendMessage({ type: MSG_SERVER_STATUS }));
    const connected = reply?.connected === true;
    statusEl.textContent = connected ? "サーバー: 接続済み" : "サーバー: 未接続";
    statusEl.className = connected ? "status connected" : "status disconnected";
}
if (syncBtn) {
    syncBtn.textContent = "全ソース同期";
    syncBtn.addEventListener("click", async () => {
        if (resultEl)
            resultEl.textContent = "同期中…";
        syncBtn.disabled = true;
        try {
            const reply = (await chrome.runtime.sendMessage({ type: MSG_SYNC }));
            if (!resultEl)
                return;
            const outcome = reply?.outcome;
            if (outcome?.ok && outcome.sources) {
                await renderSyncStatus(resultEl, outcome.sources);
            }
            else if (outcome?.error) {
                resultEl.textContent = `エラー: ${outcome.error}`;
                await refreshSyncStatus(resultEl);
            }
            else {
                resultEl.textContent = "同期に失敗しました";
                await refreshSyncStatus(resultEl);
            }
        }
        finally {
            syncBtn.disabled = false;
            await refreshStatus();
        }
    });
}
refreshStatus();
if (resultEl) {
    refreshSyncStatus(resultEl);
}
//# sourceMappingURL=popup.js.map