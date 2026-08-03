import type { FanzaVideoParsedListing } from "./types.js";
/**
 * Parse GraphQL ppvLibrary page. latestViewingRightsAcquiredAt is raw evidence only —
 * never mapped to purchased_at (spec §4 / §6).
 */
export declare function parseVideoGraphqlPayload(raw: unknown): FanzaVideoParsedListing[];
export declare function videoPageHasNext(raw: unknown): boolean;
//# sourceMappingURL=parse.d.ts.map