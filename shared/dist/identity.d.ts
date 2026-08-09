/** Listing source identifiers aligned with the SQLite `listing.source` CHECK constraint. */
export declare const SOURCES: readonly ["dlsite", "fanza_doujin", "fanza_books", "fanza_video", "fanza_dlsoft", "amazon", "ebookjapan", "kobo"];
export type Source = (typeof SOURCES)[number];
/**
 * Sources synced from the signed-in provider library DOM (user-initiated).
 * These are the sources of the typed library-sync protocol; the legacy
 * five sources keep their adapter-based import paths.
 */
export declare const LIBRARY_SOURCES: readonly ["amazon", "ebookjapan", "kobo"];
export type LibrarySource = (typeof LIBRARY_SOURCES)[number];
/**
 * Explicit acquisition/access states observed on provider library pages.
 * The generic layer only passes these through; it never infers ownership
 * from a title, price, or page presence. Provider readers map DOM evidence
 * to these states in later tasks.
 */
export declare const LIBRARY_ITEM_STATES: readonly ["purchased", "free", "rental", "sample", "preview", "subscription", "gift", "reservation", "unknown"];
export type LibraryItemState = (typeof LIBRARY_ITEM_STATES)[number];
/** Start pages of the user-initiated library sync (scope-delta 2026-08-08). */
export interface LibrarySyncProvider {
    source: LibrarySource;
    /**
     * Signed-in library entry URL the sync navigates to. amazon / ebookjapan /
     * kobo entries are confirmed by the provider reader observations
     * (single place to update).
     */
    startUrl: string;
}
export declare const LIBRARY_SYNC_PROVIDERS: readonly LibrarySyncProvider[];
/**
 * API-side page identity gate for visible DOM library batches. The readers
 * canonicalize these URLs before sending them; query values not used for
 * pagination are deliberately rejected at the server boundary.
 */
export declare function isCanonicalLibraryPageUrl(source: LibrarySource, value: string): boolean;
/** Validate the provider-specific CID format before any library persistence. */
export declare function isLibraryCid(source: LibrarySource, cid: string): boolean;
/**
 * Return a canonical product URL only when the visible link belongs to the
 * provider and its embedded identifier matches the DOM row CID.
 */
export declare function canonicalLibraryProductUrl(source: LibrarySource, cid: string, value: string): string | null;
export declare function isCanonicalLibraryProductUrl(source: LibrarySource, cid: string, value: string): boolean;
/** Resolve the library-sync provider entry for a source, if registered. */
export declare function librarySyncProvider(source: string): LibrarySyncProvider | null;
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