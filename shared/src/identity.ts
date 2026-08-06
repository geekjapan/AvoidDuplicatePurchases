/** Listing source identifiers aligned with the SQLite `listing.source` CHECK constraint. */
export const SOURCES = [
  "dlsite",
  "fanza_doujin",
  "fanza_books",
  "fanza_video",
  "fanza_dlsoft",
] as const;

export type Source = (typeof SOURCES)[number];

/** First-wave intervention stores (page + cart UI). */
export const INTERVENTION_SOURCES = ["dlsite", "fanza_doujin", "fanza_books"] as const;

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
export function productKey(identity: ProductIdentity): string {
  return `${identity.source}:${identity.cid}`;
}

/** Normalize a cid per store conventions (trim + uppercase for DLsite worknos). */
export function normalizeCid(source: Source, cid: string): string {
  const trimmed = cid.trim();
  if (source === "dlsite") {
    return trimmed.toUpperCase();
  }
  return trimmed;
}

/** Build a normalized product identity, rejecting empty cids. */
export function makeProductIdentity(source: Source, cid: string): ProductIdentity {
  const normalized = normalizeCid(source, cid);
  if (!normalized) {
    throw new Error(`empty cid for source ${source}`);
  }
  return { source, cid: normalized };
}
