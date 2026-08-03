import { parseDoujinMylibrariesPayload } from "@adp/shared/adapters/fanza_doujin";
import type { DatabaseSync } from "node:sqlite";
import { importListingBatch, type ImportCounts } from "./common.js";

export function importFanzaDoujinPayload(db: DatabaseSync, raw: unknown): ImportCounts {
  const listings = parseDoujinMylibrariesPayload(raw);
  return importListingBatch(db, "fanza_doujin", listings);
}
