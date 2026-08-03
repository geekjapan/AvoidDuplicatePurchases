import { parseBooksImportPayload } from "@adp/shared/adapters/fanza_books";
import type { DatabaseSync } from "node:sqlite";
import { importListingBatch, type ImportCounts } from "./common.js";

export function importFanzaBooksPayload(db: DatabaseSync, raw: unknown): ImportCounts {
  const listings = parseBooksImportPayload(raw);
  return importListingBatch(db, "fanza_books", listings);
}
