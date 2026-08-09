import type { Source } from "@adp/shared";
import {
  productUrlForSource,
} from "@adp/shared/adapters/dlsite";
import { extractFanzaVideoFloorFromRawJson } from "./lookup.js";

export type ImageProvenance = "store_product_metadata" | "store_library_metadata";
export type ProductUrlProvenance = "store_canonical" | "verified_derived";

/** Optional display image trust boundary: only absolute http(s) URLs are usable. */
export function sanitizeProductImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || !url.hostname) return null;
    return trimmed;
  } catch {
    return null;
  }
}

export function sanitizeProductUrl(value: unknown): string | null {
  const url = sanitizeProductImageUrl(value);
  return url && new URL(url).protocol === "https:" ? url : null;
}

function imageProvenanceFor(
  source: Source,
): ImageProvenance | null {
  if (source === "dlsite") return "store_product_metadata";
  if (source === "fanza_doujin" || source === "fanza_dlsoft") {
    return "store_library_metadata";
  }
  return null;
}

export interface ListingDisplayInput {
  source: Source;
  cid: string;
  seriesId: string | null;
  imageUrl: unknown;
  rawJson: string;
}

export function listingDisplayMetadata(input: ListingDisplayInput): {
  imageUrl: string | null;
  imageProvenance: ImageProvenance | null;
  productUrl: string | null;
  productUrlProvenance: ProductUrlProvenance | null;
} {
  // Only sources with an adapter-provenance contract may expose an image.
  // A valid URL from an unsupported source is still untrusted display data.
  const imageProvenance = imageProvenanceFor(input.source);
  const imageUrl = imageProvenance
    ? sanitizeProductImageUrl(input.imageUrl)
    : null;
  const productUrl = sanitizeProductUrl(
    productUrlForSource(input.source, input.cid, {
      seriesId: input.seriesId,
      videoFloor:
        input.source === "fanza_video"
          ? extractFanzaVideoFloorFromRawJson(input.rawJson)
          : null,
    }),
  );
  return {
    imageUrl,
    imageProvenance: imageUrl ? imageProvenance : null,
    productUrl,
    productUrlProvenance: productUrl ? "verified_derived" : null,
  };
}
