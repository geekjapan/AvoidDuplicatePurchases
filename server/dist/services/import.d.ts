import { type DlsiteSaleEntry } from "@adp/shared/adapters/dlsite";
import type { DatabaseSync } from "node:sqlite";
export type ProductFetcher = (workno: string) => Promise<unknown | null>;
export interface ImportCounts {
    inserted: number;
    updated: number;
}
export declare function importDlsitePayload(db: DatabaseSync, raw: unknown, fetchProduct?: ProductFetcher): Promise<ImportCounts>;
export declare function seedDlsiteFromSales(db: DatabaseSync, sales: DlsiteSaleEntry[], productByWorkno?: Record<string, unknown>): ImportCounts;
export declare function getSyncState(db: DatabaseSync, source: string): {
    cursor: string | null;
    lastSyncedAt: string | null;
};
//# sourceMappingURL=import.d.ts.map