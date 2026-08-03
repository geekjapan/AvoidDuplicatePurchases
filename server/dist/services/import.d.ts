import { type DlsiteSaleEntry } from "@adp/shared/adapters/dlsite";
import type { DatabaseSync } from "node:sqlite";
export type ProductFetcher = (workno: string) => Promise<unknown | null>;
/** Bound concurrent product.json fetches so first-sync stays within worker lifetime. */
export declare const PRODUCT_FETCH_CONCURRENCY = 6;
export interface ImportCounts {
    inserted: number;
    updated: number;
}
/**
 * Import a DLsite sales batch.
 * Product metadata is fetched with bounded concurrency (deferred relative to parse,
 * not sequential per-row). Cursor advances only after the full batch upserts succeed.
 */
export declare function importDlsitePayload(db: DatabaseSync, raw: unknown, fetchProduct?: ProductFetcher, concurrency?: number): Promise<ImportCounts>;
export declare function seedDlsiteFromSales(db: DatabaseSync, sales: DlsiteSaleEntry[], productByWorkno?: Record<string, unknown>): ImportCounts;
export declare function getSyncState(db: DatabaseSync, source: string): {
    cursor: string | null;
    lastSyncedAt: string | null;
};
//# sourceMappingURL=import.d.ts.map