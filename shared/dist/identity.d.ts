/** Listing source identifiers aligned with the SQLite `listing.source` CHECK constraint. */
export declare const SOURCES: readonly ["dlsite", "fanza_doujin", "fanza_books", "fanza_video", "fanza_dlsoft"];
export type Source = (typeof SOURCES)[number];
/** First-wave intervention stores (page + cart UI). */
export declare const INTERVENTION_SOURCES: readonly ["dlsite", "fanza_doujin", "fanza_books"];
export type InterventionSource = (typeof INTERVENTION_SOURCES)[number];
/** Stable product identity for cross-site deduplication. External refs use `(source, cid)`. */
export interface ProductIdentity {
    source: Source;
    cid: string;
}
/** Normalized listing fields used for match_key derivation and lookup. */
export interface ListingIdentity extends ProductIdentity {
    title: string;
    maker?: string | null;
}
/** Composite key string for maps and logs. */
export declare function productKey(identity: ProductIdentity): string;
/** Normalize a cid per store conventions (trim + uppercase for DLsite worknos). */
export declare function normalizeCid(source: Source, cid: string): string;
/** Build a normalized product identity, rejecting empty cids. */
export declare function makeProductIdentity(source: Source, cid: string): ProductIdentity;
//# sourceMappingURL=identity.d.ts.map