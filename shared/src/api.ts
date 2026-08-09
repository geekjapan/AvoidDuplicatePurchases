import { z } from "zod";

import {
  SOURCES,
  LIBRARY_SOURCES,
  LIBRARY_ITEM_STATES,
  isCanonicalLibraryPageUrl,
  isLibraryCid,
  isCanonicalLibraryProductUrl,
} from "./identity.js";

export const SourceSchema = z.enum(SOURCES);

/** Sources of the DOM library-sync protocol (amazon / ebookjapan / kobo). */
export const LibrarySourceSchema = z.enum(LIBRARY_SOURCES);

/** Explicit acquisition/access state vocabulary carried by library items. */
export const LibraryItemStateSchema = z.enum(LIBRARY_ITEM_STATES);

/** Reject empty / whitespace-only strings at API boundaries. */
const NonEmptyString = z
  .string()
  .min(1)
  .refine((s) => s.trim().length > 0, { message: "must not be blank" });

/**
 * Lookup item must carry a usable identity: non-empty `cid` and/or `title`.
 * Empty objects and blank strings are rejected (spec §7 / hard rule 3).
 */
export const LookupItemSchema = z
  .object({
    source: SourceSchema.optional(),
    cid: NonEmptyString.optional(),
    title: NonEmptyString.optional(),
    maker: NonEmptyString.optional(),
  })
  .refine((item) => item.cid !== undefined || item.title !== undefined, {
    message: "lookup item requires non-empty cid or title",
  });

export const LookupRequestSchema = z.object({
  items: z.array(LookupItemSchema).min(1),
});

export const LookupOtherSchema = z.object({
  source: SourceSchema,
  cid: NonEmptyString,
  title: NonEmptyString,
  url: z.string().url(),
});

export const LookupResultSchema = z.object({
  owned: z.boolean(),
  /** ISO8601 / date string from listing.purchased_at when owned; null/omitted when unavailable. */
  purchasedAt: z.string().nullable().optional(),
  other: z.array(LookupOtherSchema),
  /** Same normalized maker, but only a fuzzy title match; never an ownership assertion. */
  possible: z.array(LookupOtherSchema).default([]),
});

export const LookupResponseSchema = z.object({
  results: z.array(LookupResultSchema),
});

/** Path param for `POST /api/import/:source` and `GET /api/sync-state/:source`. */
export const SourcePathSchema = z.object({
  source: SourceSchema,
});

/**
 * `POST /api/import/:source` body: raw store page payload from the extension.
 * Accepts a non-empty object or non-empty array; empty payloads are rejected.
 */
export const ImportRequestSchema = z
  .union([z.record(z.string(), z.unknown()), z.array(z.unknown())])
  .refine(
    (value) =>
      Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0,
    { message: "import body must be a non-empty raw page payload" },
  );

export const ImportResponseSchema = z.object({
  inserted: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
});

/**
 * `latestOutcome` shape of the sync-state responses (identity fields stripped
 * by the server). `counts` is always present; `error` / `fetched` are the
 * per-run failure/volume evidence, never inferred values.
 */
export const SyncOutcomeSchema = z
  .object({
    ok: z.boolean(),
    counts: z
      .object({
        inserted: z.number().int().nonnegative(),
        updated: z.number().int().nonnegative(),
      })
      .strict(),
    error: z.string().nullable(),
    fetched: z.number().int().nonnegative().nullable(),
    recordedAt: z.string().datetime(),
  })
  .strict();

/**
 * `GET|POST /api/sync-state/:source` response. Strict: unknown keys and
 * malformed/missing `latestOutcome` fail closed at every client boundary.
 */
export const SyncStateResponseSchema = z
  .object({
    cursor: z.string().nullable(),
    lastSyncedAt: z.string().datetime().nullable(),
    latestOutcome: SyncOutcomeSchema.nullable(),
  })
  .strict();

export const CandidatePairSchema = z.object({
  id: z.number().int(),
  a: z.object({
    source: SourceSchema,
    cid: NonEmptyString,
    title: NonEmptyString,
    maker: z.string().nullable().optional(),
  }),
  b: z.object({
    source: SourceSchema,
    cid: NonEmptyString,
    title: NonEmptyString,
    maker: z.string().nullable().optional(),
  }),
  dice: z.number().min(0).max(1),
});

/** Optional query for `GET /api/candidates`. */
export const CandidatesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export const CandidatesResponseSchema = z.object({
  candidates: z.array(CandidatePairSchema),
});

/** Path param for `POST /api/candidates/:id`. */
export const CandidateIdPathSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const CandidateDecisionSchema = z.object({
  same: z.boolean(),
});

/** Empty JSON body for endpoints that take no request payload. */
export const EmptyRequestSchema = z.object({}).strict();

/** Empty success body where the endpoint returns no fields. */
export const EmptyResponseSchema = z.object({}).strict();

/** `POST /api/rematch` has no request body. */
export const RematchRequestSchema = EmptyRequestSchema;

export const RematchResponseSchema = z.object({
  rematched: z.number().int().nonnegative(),
  candidates: z.number().int().nonnegative(),
});

const AbsoluteHttpUrl = z.string().url().refine(
  (value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.hostname.length > 0 &&
        url.username === "" &&
        url.password === ""
      );
    } catch {
      return false;
    }
  },
  { message: "must be an absolute http(s) URL without credentials" },
);

const AbsoluteHttpsUrl = AbsoluteHttpUrl.refine(
  (value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  },
  { message: "must be an absolute https URL" },
);

const ImageProvenanceSchema = z.enum([
  "store_product_metadata",
  "store_library_metadata",
]);

const ProductUrlProvenanceSchema = z.enum(["store_canonical", "verified_derived"]);

const PurchasedAtPrecisionSchema = z.enum(["second", "day", "unknown"]);

/**
 * A store-reported money value. The schema intentionally models minor units
 * and tax semantics without doing currency conversion or tax inference.
 */
export const MoneySchema = z
  .object({
    amountMinor: z.number().int().nonnegative().safe(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    taxStatus: z.enum(["included", "excluded", "unknown"]),
  })
  .strict();

/** A current-price snapshot obtained at a known UTC observation time. */
export const CurrentPriceSchema = z
  .object({
    amountMinor: z.number().int().nonnegative().safe(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    taxStatus: z.enum(["included", "excluded", "unknown"]),
    observedAt: z.string().datetime(),
    provenance: z.enum(["store_product_metadata", "store_library_metadata"]),
  })
  .strict();

/**
 * Visible-DOM three-tier price observation (issue #45).
 * Tiers are independent; missing/ambiguous stay null. Never calculated.
 * `observedAt` is the server receipt instant (UTC), not a sale/coupon deadline.
 */
export const PriceObservationSchema = z
  .object({
    regular: MoneySchema.extend({ currency: z.literal("JPY") }).nullable(),
    sale: MoneySchema.extend({ currency: z.literal("JPY") }).nullable(),
    coupon: MoneySchema.extend({ currency: z.literal("JPY") }).nullable(),
    observedAt: z.string().datetime(),
  })
  .strict();

/**
 * Extension → server payload for an owned listing's visible product-page prices.
 * Server stamps `observedAt`; client must not send purchasePrice.
 */
export const PriceObservationRequestSchema = z
  .object({
    source: SourceSchema,
    cid: NonEmptyString,
    pageUrl: AbsoluteHttpsUrl,
    regular: MoneySchema.extend({ currency: z.literal("JPY") }).nullable(),
    sale: MoneySchema.extend({ currency: z.literal("JPY") }).nullable(),
    coupon: MoneySchema.extend({ currency: z.literal("JPY") }).nullable(),
  })
  .strict();

export const PriceObservationResponseSchema = z
  .object({
    ok: z.literal(true),
    priceObservation: PriceObservationSchema,
  })
  .strict();

/**
 * One DOM-observed library item of the typed library-sync protocol.
 * The schema is strict and carries no price fields: Amazon/ebookjapan/Kobo
 * price values stay null/未取得 until a later price contract is defined.
 * `state` is reader-supplied evidence; the server never infers it.
 */
export const LibraryImportItemSchema = z
  .object({
    cid: NonEmptyString,
    title: NonEmptyString,
    state: LibraryItemStateSchema,
    maker: NonEmptyString.nullable().optional(),
    seriesId: NonEmptyString.nullable().optional(),
    imageUrl: AbsoluteHttpUrl.nullable().optional(),
    productUrl: AbsoluteHttpsUrl.nullable().optional(),
  })
  .strict();

/**
 * `POST /api/import/library` body: one bounded visible batch with the page
 * the batch was read from. `pageUrl` must be absolute https (the DOM sync
 * protocol never reads private-network or non-https pages).
 * The generic layer preserves every state verbatim; ownership mapping is a
 * provider-task concern and never happens here.
 */
export const LibraryImportRequestSchema = z
  .object({
    source: LibrarySourceSchema,
    pageUrl: AbsoluteHttpsUrl,
    items: z.array(LibraryImportItemSchema).min(1).max(100),
  })
  .strict()
  .superRefine((request, ctx) => {
    if (!isCanonicalLibraryPageUrl(request.source, request.pageUrl)) {
      ctx.addIssue({
        code: "custom",
        path: ["pageUrl"],
        message: "pageUrl is not a canonical provider library URL",
      });
    }
    request.items.forEach((item, index) => {
      if (!isLibraryCid(request.source, item.cid)) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "cid"],
          message: "cid does not match the provider format",
        });
      }
      if (
        item.productUrl !== undefined &&
        item.productUrl !== null &&
        !isCanonicalLibraryProductUrl(request.source, item.cid, item.productUrl)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "productUrl"],
          message: "productUrl is not a canonical product URL for the CID",
        });
      }
    });
  });

/** Per-state observed counts; every vocabulary state key is required. */
const LibraryImportByStateSchema = z
  .object(
    Object.fromEntries(
      LIBRARY_ITEM_STATES.map((state) => [state, z.number().int().nonnegative()]),
    ) as Record<(typeof LIBRARY_ITEM_STATES)[number], z.ZodNumber>,
  )
  .strict();

export const LibraryImportResponseSchema = z
  .object({
    observed: z.number().int().nonnegative(),
    inserted: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    /** Per-state observed counts; the server always emits every state key. */
    byState: LibraryImportByStateSchema,
  })
  .strict();

/** Query for `GET /api/listings` (library search / list). */
export const ListingsQuerySchema = z.object({
  q: z.string().optional(),
  source: SourceSchema.optional(),
  maker: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

/** One listing row as returned to the management UI. */
export const ListingSchema = z
  .object({
    id: z.number().int().positive(),
    source: SourceSchema,
    cid: NonEmptyString,
    workId: z.number().int().positive(),
    workIdLocked: z.boolean(),
    title: NonEmptyString,
    maker: z.string().nullable(),
    seriesId: z.string().nullable(),
    imageUrl: AbsoluteHttpUrl.nullable(),
    imageProvenance: ImageProvenanceSchema.nullable(),
    productUrl: AbsoluteHttpsUrl.nullable(),
    productUrlProvenance: ProductUrlProvenanceSchema.nullable(),
    purchasedAt: z.string().nullable(),
    purchasedAtPrecision: PurchasedAtPrecisionSchema,
    purchasePrice: MoneySchema.nullable(),
    currentPrice: CurrentPriceSchema.nullable(),
    /** Visible-DOM three-tier observation; null when never recorded. */
    priceObservation: PriceObservationSchema.nullable(),
  })
  .strict()
  .superRefine((listing, ctx) => {
    if ((listing.imageUrl === null) !== (listing.imageProvenance === null)) {
      ctx.addIssue({
        code: "custom",
        path: ["imageProvenance"],
        message: "imageUrl and imageProvenance must be present together",
      });
    }
    if ((listing.productUrl === null) !== (listing.productUrlProvenance === null)) {
      ctx.addIssue({
        code: "custom",
        path: ["productUrlProvenance"],
        message: "productUrl and productUrlProvenance must be present together",
      });
    }
  });

export const ListingsResponseSchema = z
  .object({
    listings: z.array(ListingSchema),
    total: z.number().int().nonnegative().optional(),
  })
  .strict();

export const ManualListingRequestSchema = z.object({
  url: z.string().url(),
});

export const ManualListingResponseSchema = z.object({
  listing: ListingSchema,
});

/** Path params for `POST /api/listings/:source/:cid/work`. */
export const ListingWorkPathSchema = z.object({
  source: SourceSchema,
  cid: NonEmptyString,
});

export const WorkAssignmentRequestSchema = z.object({
  workId: z.number().int().positive(),
  lock: z.boolean().optional(),
});

export const WorkAssignmentResponseSchema = z.object({
  workId: z.number().int().positive(),
  locked: z.boolean(),
});

export const ExportRequestSchema = z.object({
  destination: z.string().min(1),
});

export const ExportResponseSchema = z.object({
  path: NonEmptyString,
});

export type LookupItem = z.infer<typeof LookupItemSchema>;
export type LookupRequest = z.infer<typeof LookupRequestSchema>;
export type LookupResult = z.infer<typeof LookupResultSchema>;
export type LookupResponse = z.infer<typeof LookupResponseSchema>;
export type ImportRequest = z.infer<typeof ImportRequestSchema>;
export type ImportResponse = z.infer<typeof ImportResponseSchema>;
export type LibraryImportItem = z.infer<typeof LibraryImportItemSchema>;
export type LibraryImportRequest = z.infer<typeof LibraryImportRequestSchema>;
export type LibraryImportResponse = z.infer<typeof LibraryImportResponseSchema>;
export type SyncOutcome = z.infer<typeof SyncOutcomeSchema>;
export type SyncStateResponse = z.infer<typeof SyncStateResponseSchema>;
export type Money = z.infer<typeof MoneySchema>;
export type CurrentPrice = z.infer<typeof CurrentPriceSchema>;
export type PriceObservation = z.infer<typeof PriceObservationSchema>;
export type PriceObservationRequest = z.infer<typeof PriceObservationRequestSchema>;
export type PriceObservationResponse = z.infer<typeof PriceObservationResponseSchema>;
export type ListingsQuery = z.infer<typeof ListingsQuerySchema>;
export type ListingsResponse = z.infer<typeof ListingsResponseSchema>;
