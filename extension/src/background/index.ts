import { registerMessaging, updateDisconnectedBadge } from "./messaging.js";
import { registerAlarms } from "../alarms.js";

registerMessaging();
void registerAlarms().catch(() => {
  // Registration is retried on the next service-worker start.
});

updateDisconnectedBadge();
setInterval(() => updateDisconnectedBadge(), 30000);
