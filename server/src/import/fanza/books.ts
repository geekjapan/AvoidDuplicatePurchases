import {
  booksContentsPageInfo,
  booksLibraryPageInfo,
  parseBooksImportBody,
  parseBooksImportPayload,
  parseBooksLibraryPayload,
  type FanzaBooksSeriesRef,
} from "@adp/shared/adapters/fanza_books";
import type { DatabaseSync } from "node:sqlite";
import { importListingBatch, type ImportCounts } from "./common.js";

export interface FanzaBooksImportResult extends ImportCounts {
  series?: FanzaBooksSeriesRef[];
  itemCount: number;
  totalCount: number;
  hasNext: boolean;
}

export function importFanzaBooksPayload(
  db: DatabaseSync,
  raw: unknown,
): FanzaBooksImportResult {
  if (raw && typeof raw === "object" && "series_books" in raw) {
    return {
      inserted: 0,
      updated: 0,
      series: parseBooksLibraryPayload(raw),
      ...booksLibraryPageInfo(raw),
    };
  }
  const body = parseBooksImportBody(raw);
  const listings = parseBooksImportPayload(raw);
  return {
    ...importListingBatch(db, "fanza_books", listings),
    ...booksContentsPageInfo(body.payload),
  };
}
