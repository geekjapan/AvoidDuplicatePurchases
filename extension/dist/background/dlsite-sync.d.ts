import { type ImportCounts } from "./server-client.js";
export interface SyncOutcome {
    ok: boolean;
    counts?: ImportCounts;
    error?: string;
    fetched?: number;
}
/** Fetch DLsite sales history via authenticated browser session. */
export declare function fetchDlsiteSales(last?: string): Promise<{
    ok: true;
    sales: unknown;
} | {
    ok: false;
    error: string;
}>;
/** Full manual sync: fetch sales → import → rematch. */
export declare function runDlsiteSync(): Promise<SyncOutcome>;
//# sourceMappingURL=dlsite-sync.d.ts.map