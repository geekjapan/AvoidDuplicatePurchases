export interface FanzaBooksSeriesRef {
  seriesId: string;
  author: string | null;
  /** Untouched synthetic/redacted series-level source entry from the library response. */
  seriesRaw: Record<string, unknown>;
}

export interface FanzaBooksParsedListing {
  cid: string;
  title: string;
  maker: string | null;
  seriesId: string;
  imageUrl: string | null;
  purchasedAt: string;
  purchasedAtPrecision: "second";
  rawJson: string;
}

/** Import body for one contents API page (series context required for maker + URL). */
export interface FanzaBooksImportPayload {
  seriesId: string;
  author?: string | null;
  /** Optional full series-level raw entry preserved from the first library response. */
  seriesRaw?: Record<string, unknown> | null;
  payload: unknown;
}
