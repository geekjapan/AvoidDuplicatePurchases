import { z } from "zod";
import type { FanzaBooksImportPayload, FanzaBooksParsedListing, FanzaBooksSeriesRef } from "./types.js";

const SeriesEntrySchema = z
  .object({
    series_id: z.union([z.string(), z.number()]).optional(),
    id: z.union([z.string(), z.number()]).optional(),
    author: z.string().optional(),
    author_name: z.string().optional(),
    authors: z.array(z.object({ name: z.string().optional() }).passthrough()).optional(),
  })
  .passthrough();

const LibraryPageSchema = z.object({
  series_books: z.array(SeriesEntrySchema).optional(),
  pager: z
    .object({
      page: z.number().optional(),
      per_page: z.number().optional(),
      total_count: z.number().optional(),
    })
    .optional(),
});

const VolumeSchema = z
  .object({
    content_id: z.string().min(1),
    title: z.string().min(1),
    volume_number: z.number().optional(),
    purchased: z.object({ purchased_date: z.string().min(1) }).nullable().optional(),
  })
  .passthrough();

const ContentsPageSchema = z.object({
  volume_books: z.array(VolumeSchema).optional(),
  pager: z
    .object({
      page: z.number().optional(),
      per_page: z.number().optional(),
      total_count: z.number().optional(),
    })
    .optional(),
});

const ImportBodySchema = z.object({
  seriesId: z.string().min(1),
  author: z.string().nullable().optional(),
  payload: z.unknown(),
});

function seriesAuthor(entry: z.infer<typeof SeriesEntrySchema>): string | null {
  if (typeof entry.author === "string" && entry.author.trim()) return entry.author.trim();
  if (typeof entry.author_name === "string" && entry.author_name.trim()) {
    return entry.author_name.trim();
  }
  const first = entry.authors?.[0];
  if (first && typeof first.name === "string" && first.name.trim()) return first.name.trim();
  return null;
}

function seriesIdFromEntry(entry: z.infer<typeof SeriesEntrySchema>): string | null {
  const raw = entry.series_id ?? entry.id;
  if (typeof raw === "number") return String(raw);
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return null;
}

/** Extract purchasable series refs from a library page (shop_name=all scope). */
export function parseBooksLibraryPayload(raw: unknown): FanzaBooksSeriesRef[] {
  const parsed = LibraryPageSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("fanza_books library payload failed schema validation");
  }
  const out: FanzaBooksSeriesRef[] = [];
  for (const entry of parsed.data.series_books ?? []) {
    const seriesId = seriesIdFromEntry(entry);
    if (!seriesId) continue;
    out.push({ seriesId, author: seriesAuthor(entry) });
  }
  return out;
}

export function booksLibraryHasNext(raw: unknown): boolean {
  const parsed = LibraryPageSchema.safeParse(raw);
  if (!parsed.success) return false;
  const pager = parsed.data.pager;
  if (!pager) return false;
  const page = pager.page ?? 1;
  const perPage = pager.per_page ?? 20;
  const total = pager.total_count ?? 0;
  return page * perPage < total;
}

function volumeEvidence(
  volume: z.infer<typeof VolumeSchema>,
  seriesId: string,
  author: string | null,
): Record<string, unknown> {
  return {
    ...volume,
    seriesId,
    author,
  };
}

/** Parse one contents page; purchased volumes only; second-precision ISO8601 dates. */
export function parseBooksContentsPayload(
  raw: unknown,
  seriesId: string,
  author: string | null = null,
): FanzaBooksParsedListing[] {
  const parsed = ContentsPageSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("fanza_books contents payload failed schema validation");
  }
  const sid = seriesId.trim();
  const out: FanzaBooksParsedListing[] = [];
  for (const volume of parsed.data.volume_books ?? []) {
    const purchasedDate = volume.purchased?.purchased_date;
    if (!purchasedDate) continue;
    const maker = author?.trim() ? author.trim() : null;
    out.push({
      cid: volume.content_id.trim(),
      title: volume.title.trim(),
      maker,
      seriesId: sid,
      imageUrl: null,
      purchasedAt: purchasedDate.trim(),
      purchasedAtPrecision: "second",
      rawJson: JSON.stringify({ sale: volumeEvidence(volume, sid, maker) }),
    });
  }
  return out;
}

/** Normalize extension POST body `{ seriesId, author?, payload }`. */
export function parseBooksImportBody(raw: unknown): FanzaBooksImportPayload {
  const parsed = ImportBodySchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("fanza_books import body failed schema validation");
  }
  return {
    seriesId: parsed.data.seriesId.trim(),
    author: parsed.data.author ?? null,
    payload: parsed.data.payload,
  };
}

export function parseBooksImportPayload(raw: unknown): FanzaBooksParsedListing[] {
  const body = parseBooksImportBody(raw);
  return parseBooksContentsPayload(body.payload, body.seriesId, body.author);
}

export function booksContentsHasNext(raw: unknown): boolean {
  const parsed = ContentsPageSchema.safeParse(raw);
  if (!parsed.success) return false;
  const pager = parsed.data.pager;
  if (!pager) return false;
  const page = pager.page ?? 1;
  const perPage = pager.per_page ?? 100;
  const total = pager.total_count ?? 0;
  return page * perPage < total;
}
