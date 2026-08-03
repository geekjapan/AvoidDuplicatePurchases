import { type FullSyncOutcome } from "../alarms.js";
/** Populate per-source sync status rows in the popup. */
export declare function renderSyncStatus(container: HTMLElement, outcomes?: FullSyncOutcome["sources"]): Promise<void>;
/** Refresh status without sync outcomes (last-synced only). */
export declare function refreshSyncStatus(container: HTMLElement): Promise<void>;
//# sourceMappingURL=sync-status.d.ts.map