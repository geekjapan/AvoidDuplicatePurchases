import { MSG_SERVER_STATUS, MSG_SYNC } from "../messages.js";
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
    syncBtn.addEventListener("click", async () => {
        if (resultEl)
            resultEl.textContent = "同期中…";
        syncBtn.disabled = true;
        try {
            const reply = (await chrome.runtime.sendMessage({ type: MSG_SYNC }));
            if (!resultEl)
                return;
            const outcome = reply?.outcome;
            if (outcome?.ok && outcome.counts) {
                resultEl.textContent = `取得 ${outcome.fetched ?? "?"} 件\n新規 ${outcome.counts.inserted} / 更新 ${outcome.counts.updated}`;
            }
            else if (outcome?.error) {
                resultEl.textContent = `エラー: ${outcome.error}`;
            }
            else {
                resultEl.textContent = "同期に失敗しました";
            }
        }
        finally {
            syncBtn.disabled = false;
            await refreshStatus();
        }
    });
}
refreshStatus();
//# sourceMappingURL=popup.js.map