import {
  parseVideoGraphqlPayload,
  videoPageHasNext,
} from "@adp/shared/adapters/fanza_video";
import type { DatabaseSync } from "node:sqlite";
import { importListingBatch, type ImportCounts } from "./common.js";

export interface FanzaVideoImportResult extends ImportCounts {
  hasNext: boolean;
}

export function importFanzaVideoPayload(
  db: DatabaseSync,
  raw: unknown,
): FanzaVideoImportResult {
  const listings = parseVideoGraphqlPayload(raw);
  return {
    ...importListingBatch(db, "fanza_video", listings),
    hasNext: videoPageHasNext(raw),
  };
}
