import { z } from "zod";
import { SOURCES } from "./identity.js";
export const SourceSchema = z.enum(SOURCES);
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
    .refine((value) => Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0, { message: "import body must be a non-empty raw page payload" });
export const ImportResponseSchema = z.object({
    inserted: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
});
export const SyncStateResponseSchema = z.object({
    cursor: z.string().nullable(),
    lastSyncedAt: z.string().datetime().nullable(),
});
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
/** Query for `GET /api/listings` (library search / list). */
export const ListingsQuerySchema = z.object({
    q: z.string().optional(),
    source: SourceSchema.optional(),
    maker: z.string().optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
    offset: z.coerce.number().int().nonnegative().optional(),
});
/** One listing row as returned to the management UI. */
export const ListingSchema = z.object({
    id: z.number().int().positive(),
    source: SourceSchema,
    cid: NonEmptyString,
    workId: z.number().int().positive(),
    workIdLocked: z.boolean().optional(),
    title: NonEmptyString,
    maker: z.string().nullable().optional(),
    seriesId: z.string().nullable().optional(),
    imageUrl: z.string().url().nullable().optional(),
    purchasedAt: z.string().nullable().optional(),
});
export const ListingsResponseSchema = z.object({
    listings: z.array(ListingSchema),
    total: z.number().int().nonnegative().optional(),
});
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
//# sourceMappingURL=api.js.map