import {
  dlsoftPageInfo,
  parseDlsoftLibraryPayload,
} from "@adp/shared/adapters/fanza_dlsoft";
import type { DatabaseSync } from "node:sqlite";
import { importListingBatch, type ImportCounts } from "./common.js";

export interface FanzaDlsoftImportResult extends ImportCounts {
  itemCount: number;
  totalCount: number;
}

export function importFanzaDlsoftPayload(
  db: DatabaseSync,
  raw: unknown,
): FanzaDlsoftImportResult {
  const listings = parseDlsoftLibraryPayload(raw);
  return {
    ...importListingBatch(db, "fanza_dlsoft", listings),
    ...dlsoftPageInfo(raw),
  };
}
