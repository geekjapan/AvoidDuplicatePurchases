import type { FanzaDoujinParsedListing } from "./types.js";
/** Parse Japanese calendar date key `YYYY年MM月DD日` → `YYYY-MM-DD`. */
export declare function parseJpDateKey(key: string): string | null;
/** Parse one mylibraries page payload into listing stubs (day-precision purchased_at). */
export declare function parseDoujinMylibrariesPayload(raw: unknown): FanzaDoujinParsedListing[];
export declare function doujinPageHasNext(raw: unknown): boolean;
//# sourceMappingURL=parse.d.ts.map