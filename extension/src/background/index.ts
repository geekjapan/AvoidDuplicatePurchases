import { registerMessaging, updateDisconnectedBadge } from "./messaging.js";
import { registerAlarms } from "../alarms.js";

registerMessaging();
registerAlarms();

updateDisconnectedBadge();
setInterval(() => updateDisconnectedBadge(), 30000);
