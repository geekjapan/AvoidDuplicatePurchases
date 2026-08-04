import { z } from "zod";
import type { FanzaBooksImportPayload, FanzaBooksParsedListing, FanzaBooksSeriesRef } from "./types.js";

const NonBlankString = z.string().trim().min(1);
const StrictIso8601DateTime = z.string().datetime({ offset: true });
const OptionalSourceErrorSchema = z
  .unknown()
  .optional()
  .refine((value) => value === undefined || value === null, { message: "source error" });

const SeriesEntrySchema = z
  .object({
    series_id: z.union([NonBlankString, z.number()]).optional(),
    id: z.union([NonBlankString, z.number()]).optional(),
    author: z.string().optional(),
    author_name: z.string().optional(),
    authors: z.array(z.object({ name: z.string().optional() }).passthrough()).optional(),
  })
  .passthrough();

const LibraryPageSchema = z.object({
  error: OptionalSourceErrorSchema,
  errors: OptionalSourceErrorSchema,
  series_books: z.array(SeriesEntrySchema),
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
    content_id: NonBlankString,
    title: NonBlankString,
    volume_number: z.number().optional(),
    purchased: z.object({ purchased_date: StrictIso8601DateTime }).nullable().optional(),
  })
  .passthrough();

const ContentsPageSchema = z.object({
  error: OptionalSourceErrorSchema,
  errors: OptionalSourceErrorSchema,
  volume_books: z.array(VolumeSchema),
  pager: z
    .object({
      page: z.number().optional(),
      per_page: z.number().optional(),
      total_count: z.number().optional(),
    })
    .optional(),
});

const ImportBodySchema = z.object({
  seriesId: NonBlankString,
  author: z.string().nullable().optional(),
  seriesRaw: z.record(z.string(), z.unknown()).nullable().optional(),
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
    // Keep the full series entry (unknown/nested fields included) for listing.raw_json.
    out.push({
      seriesId,
      author: seriesAuthor(entry),
      seriesRaw: { ...entry },
    });
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
  seriesRaw: Record<string, unknown> | null,
): Record<string, unknown> {
  const evidence: Record<string, unknown> = {
    ...volume,
    seriesId,
    author,
  };
  // Preserve untouched series-level source entry alongside volume evidence.
  if (seriesRaw) {
    evidence.series = { ...seriesRaw };
  }
  return evidence;
}

/** Parse one contents page; purchased volumes only; second-precision ISO8601 dates. */
export function parseBooksContentsPayload(
  raw: unknown,
  seriesId: string,
  author: string | null = null,
  seriesRaw: Record<string, unknown> | null = null,
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
      rawJson: JSON.stringify({ sale: volumeEvidence(volume, sid, maker, seriesRaw) }),
    });
  }
  return out;
}

/** Normalize extension POST body `{ seriesId, author?, seriesRaw?, payload }`. */
export function parseBooksImportBody(raw: unknown): FanzaBooksImportPayload {
  const parsed = ImportBodySchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("fanza_books import body failed schema validation");
  }
  return {
    seriesId: parsed.data.seriesId.trim(),
    author: parsed.data.author ?? null,
    seriesRaw: parsed.data.seriesRaw ?? null,
    payload: parsed.data.payload,
  };
}

export function parseBooksImportPayload(raw: unknown): FanzaBooksParsedListing[] {
  const body = parseBooksImportBody(raw);
  return parseBooksContentsPayload(
    body.payload,
    body.seriesId,
    body.author ?? null,
    body.seriesRaw ?? null,
  );
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
