import { type ImportCounts, type SyncState } from "../../background/server-client.js";
export type { ImportCounts, SyncState };
export type FanzaImportSource = "fanza_doujin" | "fanza_books" | "fanza_video" | "fanza_dlsoft";
export declare const FANZA_SOURCES: readonly FanzaImportSource[];
export declare const ALL_SYNC_SOURCES: readonly ["dlsite", ...FanzaImportSource[]];
export declare function importFanzaOnServer(source: FanzaImportSource, payload: unknown): Promise<{
    ok: true;
    counts: ImportCounts;
} | {
    ok: false;
    error: string;
}>;
export declare function markFanzaSyncedOnServer(source: FanzaImportSource): Promise<{
    ok: true;
    state: SyncState;
} | {
    ok: false;
    error: string;
}>;
export declare function getSourceSyncState(source: string): Promise<SyncState | null>;
export declare function getAllSyncStates(): Promise<Record<string, SyncState | null>>;
export declare function listSyncSources(): readonly string[];
//# sourceMappingURL=server-api.d.ts.map