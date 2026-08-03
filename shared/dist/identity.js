/** Listing source identifiers aligned with the SQLite `listing.source` CHECK constraint. */
export const SOURCES = [
    "dlsite",
    "fanza_doujin",
    "fanza_books",
    "fanza_video",
    "fanza_dlsoft",
];
/** First-wave intervention stores (page + cart UI). */
export const INTERVENTION_SOURCES = ["dlsite", "fanza_doujin", "fanza_books"];
/** Composite key string for maps and logs. */
export function productKey(identity) {
    return `${identity.source}:${identity.cid}`;
}
/** Normalize a cid per store conventions (trim + uppercase for DLsite worknos). */
export function normalizeCid(source, cid) {
    const trimmed = cid.trim();
    if (source === "dlsite") {
        return trimmed.toUpperCase();
    }
    return trimmed;
}
/** Build a normalized product identity, rejecting empty cids. */
export function makeProductIdentity(source, cid) {
    const normalized = normalizeCid(source, cid);
    if (!normalized) {
        throw new Error(`empty cid for source ${source}`);
    }
    return { source, cid: normalized };
}
//# sourceMappingURL=identity.js.map