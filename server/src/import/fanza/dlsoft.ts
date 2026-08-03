import { parseDlsoftLibraryPayload } from "@adp/shared/adapters/fanza_dlsoft";
import type { DatabaseSync } from "node:sqlite";
import { importListingBatch, type ImportCounts } from "./common.js";

export function importFanzaDlsoftPayload(db: DatabaseSync, raw: unknown): ImportCounts {
  const listings = parseDlsoftLibraryPayload(raw);
  return importListingBatch(db, "fanza_dlsoft", listings);
}
