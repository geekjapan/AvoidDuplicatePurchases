import { type LookupItem, type LookupResult, type Source } from "@adp/shared";
import type { DatabaseSync } from "node:sqlite";
export interface ListingRow {
    id: number;
    source: Source;
    cid: string;
    workId: number;
    title: string;
    maker: string | null;
}
export declare function hasListing(db: DatabaseSync, source: Source, cid: string): boolean;
export declare function lookupItems(db: DatabaseSync, items: LookupItem[]): LookupResult[];
export declare function recomputeMatchKeys(db: DatabaseSync, listingId: number): void;
export declare function runRematch(db: DatabaseSync): {
    rematched: number;
    candidates: number;
};
//# sourceMappingURL=lookup.d.ts.map