import { type ImportCounts } from "./server-api.js";
export interface SourceSyncOutcome {
    ok: boolean;
    counts?: ImportCounts;
    error?: string;
    fetched?: number;
}
export declare function runFanzaDoujinSync(): Promise<SourceSyncOutcome>;
export declare function runFanzaBooksSync(): Promise<SourceSyncOutcome>;
export declare function runFanzaVideoSync(): Promise<SourceSyncOutcome>;
export declare function runFanzaDlsoftSync(): Promise<SourceSyncOutcome>;
export declare function runAllFanzaSyncs(): Promise<Record<string, SourceSyncOutcome>>;
//# sourceMappingURL=sync.d.ts.map