import { z } from "zod";
import type { FanzaDlsoftParsedListing } from "./types.js";

const LibraryItemSchema = z
  .object({
    contentId: z.string().min(1),
    productId: z.string().optional(),
    title: z.string().min(1),
    floor: z.string().optional(),
    brand: z.object({ name: z.string().optional() }).nullable().optional(),
    authorArray: z.array(z.object({ name: z.string().optional() }).passthrough()).optional(),
    packageImageUrl: z.string().optional(),
    deliveryBeginDate: z.string().optional(),
  })
  .passthrough();

const LibraryPageSchema = z.object({
  error: z.unknown().optional(),
  body: z.object({
    totalCount: z.number().optional(),
    library: z.array(LibraryItemSchema).optional(),
  }),
});

function itemEvidence(item: z.infer<typeof LibraryItemSchema>): Record<string, unknown> {
  return { ...item };
}

/** Parse dlsoft library page; no purchase date (deliveryBeginDate is not purchased_at). */
export function parseDlsoftLibraryPayload(raw: unknown): FanzaDlsoftParsedListing[] {
  const parsed = LibraryPageSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("fanza_dlsoft payload failed schema validation");
  }
  return (parsed.data.body.library ?? []).map((item) => {
    const makerFromBrand =
      item.brand && typeof item.brand.name === "string" && item.brand.name.trim()
        ? item.brand.name.trim()
        : null;
    const imageUrl =
      typeof item.packageImageUrl === "string" && item.packageImageUrl.trim()
        ? item.packageImageUrl.trim()
        : null;
    return {
      cid: item.contentId.trim(),
      title: item.title.trim(),
      maker: makerFromBrand,
      seriesId: null,
      imageUrl,
      purchasedAt: null,
      purchasedAtPrecision: "unknown",
      rawJson: JSON.stringify({ sale: itemEvidence(item) }),
    };
  });
}

export function dlsoftPageHasNext(raw: unknown, fetchedSoFar: number): boolean {
  const parsed = LibraryPageSchema.safeParse(raw);
  if (!parsed.success) return false;
  const library = parsed.data.body.library ?? [];
  if (library.length === 0) return false;
  const total = parsed.data.body.totalCount ?? fetchedSoFar;
  return fetchedSoFar < total;
}
