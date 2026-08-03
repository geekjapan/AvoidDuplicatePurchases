import { parseVideoGraphqlPayload } from "@adp/shared/adapters/fanza_video";
import type { DatabaseSync } from "node:sqlite";
import { importListingBatch, type ImportCounts } from "./common.js";

export function importFanzaVideoPayload(db: DatabaseSync, raw: unknown): ImportCounts {
  const listings = parseVideoGraphqlPayload(raw);
  return importListingBatch(db, "fanza_video", listings);
}
