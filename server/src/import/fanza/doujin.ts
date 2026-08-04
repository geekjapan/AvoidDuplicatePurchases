import {
  doujinPageHasNext,
  parseDoujinMylibrariesPayload,
} from "@adp/shared/adapters/fanza_doujin";
import type { DatabaseSync } from "node:sqlite";
import { importListingBatch, type ImportCounts } from "./common.js";

export interface FanzaDoujinImportResult extends ImportCounts {
  hasNext: boolean;
}

export function importFanzaDoujinPayload(
  db: DatabaseSync,
  raw: unknown,
): FanzaDoujinImportResult {
  const listings = parseDoujinMylibrariesPayload(raw);
  return {
    ...importListingBatch(db, "fanza_doujin", listings),
    hasNext: doujinPageHasNext(raw),
  };
}
