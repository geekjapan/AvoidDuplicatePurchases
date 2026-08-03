export interface FanzaBooksSeriesRef {
  seriesId: string;
  author: string | null;
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
  payload: unknown;
}
