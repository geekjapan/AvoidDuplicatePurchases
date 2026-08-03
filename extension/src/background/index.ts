import { registerMessaging, updateDisconnectedBadge } from "./messaging.js";
import { DAILY_SYNC_ALARM, handleDailySyncAlarm } from "./dlsite-sync.js";

registerMessaging();

chrome.alarms.create(DAILY_SYNC_ALARM, { periodInMinutes: 1440 });
chrome.alarms.onAlarm.addListener((alarm) => {
  // Static import of handleDailySyncAlarm → runDlsiteSync (MV3 SW: dynamic imports unsupported).
  handleDailySyncAlarm(alarm);
});

updateDisconnectedBadge();
setInterval(() => updateDisconnectedBadge(), 30000);
