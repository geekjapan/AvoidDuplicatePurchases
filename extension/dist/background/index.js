import { registerMessaging, updateDisconnectedBadge } from "./messaging.js";
registerMessaging();
chrome.alarms.create("adp-daily-sync", { periodInMinutes: 1440 });
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "adp-daily-sync") {
        import("./dlsite-sync.js").then(({ runDlsiteSync }) => runDlsiteSync());
    }
});
updateDisconnectedBadge();
setInterval(() => updateDisconnectedBadge(), 30000);
//# sourceMappingURL=index.js.map