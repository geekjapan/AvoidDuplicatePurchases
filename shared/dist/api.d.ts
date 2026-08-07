import { z } from "zod";
export declare const SourceSchema: z.ZodEnum<{
    dlsite: "dlsite";
    fanza_doujin: "fanza_doujin";
    fanza_books: "fanza_books";
    fanza_video: "fanza_video";
    fanza_dlsoft: "fanza_dlsoft";
}>;
/**
 * Lookup item must carry a usable identity: non-empty `cid` and/or `title`.
 * Empty objects and blank strings are rejected (spec §7 / hard rule 3).
 */
export declare const LookupItemSchema: z.ZodObject<{
    source: z.ZodOptional<z.ZodEnum<{
        dlsite: "dlsite";
        fanza_doujin: "fanza_doujin";
        fanza_books: "fanza_books";
        fanza_video: "fanza_video";
        fanza_dlsoft: "fanza_dlsoft";
    }>>;
    cid: z.ZodOptional<z.ZodString>;
    title: z.ZodOptional<z.ZodString>;
    maker: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const LookupRequestSchema: z.ZodObject<{
    items: z.ZodArray<z.ZodObject<{
        source: z.ZodOptional<z.ZodEnum<{
            dlsite: "dlsite";
            fanza_doujin: "fanza_doujin";
            fanza_books: "fanza_books";
            fanza_video: "fanza_video";
            fanza_dlsoft: "fanza_dlsoft";
        }>>;
        cid: z.ZodOptional<z.ZodString>;
        title: z.ZodOptional<z.ZodString>;
        maker: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const LookupOtherSchema: z.ZodObject<{
    source: z.ZodEnum<{
        dlsite: "dlsite";
        fanza_doujin: "fanza_doujin";
        fanza_books: "fanza_books";
        fanza_video: "fanza_video";
        fanza_dlsoft: "fanza_dlsoft";
    }>;
    cid: z.ZodString;
    title: z.ZodString;
    url: z.ZodString;
}, z.core.$strip>;
export declare const LookupResultSchema: z.ZodObject<{
    owned: z.ZodBoolean;
    purchasedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    other: z.ZodArray<z.ZodObject<{
        source: z.ZodEnum<{
            dlsite: "dlsite";
            fanza_doujin: "fanza_doujin";
            fanza_books: "fanza_books";
            fanza_video: "fanza_video";
            fanza_dlsoft: "fanza_dlsoft";
        }>;
        cid: z.ZodString;
        title: z.ZodString;
        url: z.ZodString;
    }, z.core.$strip>>;
    possible: z.ZodDefault<z.ZodArray<z.ZodObject<{
        source: z.ZodEnum<{
            dlsite: "dlsite";
            fanza_doujin: "fanza_doujin";
            fanza_books: "fanza_books";
            fanza_video: "fanza_video";
            fanza_dlsoft: "fanza_dlsoft";
        }>;
        cid: z.ZodString;
        title: z.ZodString;
        url: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export declare const LookupResponseSchema: z.ZodObject<{
    results: z.ZodArray<z.ZodObject<{
        owned: z.ZodBoolean;
        purchasedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        other: z.ZodArray<z.ZodObject<{
            source: z.ZodEnum<{
                dlsite: "dlsite";
                fanza_doujin: "fanza_doujin";
                fanza_books: "fanza_books";
                fanza_video: "fanza_video";
                fanza_dlsoft: "fanza_dlsoft";
            }>;
            cid: z.ZodString;
            title: z.ZodString;
            url: z.ZodString;
        }, z.core.$strip>>;
        possible: z.ZodDefault<z.ZodArray<z.ZodObject<{
            source: z.ZodEnum<{
                dlsite: "dlsite";
                fanza_doujin: "fanza_doujin";
                fanza_books: "fanza_books";
                fanza_video: "fanza_video";
                fanza_dlsoft: "fanza_dlsoft";
            }>;
            cid: z.ZodString;
            title: z.ZodString;
            url: z.ZodString;
        }, z.core.$strip>>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** Path param for `POST /api/import/:source` and `GET /api/sync-state/:source`. */
export declare const SourcePathSchema: z.ZodObject<{
    source: z.ZodEnum<{
        dlsite: "dlsite";
        fanza_doujin: "fanza_doujin";
        fanza_books: "fanza_books";
        fanza_video: "fanza_video";
        fanza_dlsoft: "fanza_dlsoft";
    }>;
}, z.core.$strip>;
/**
 * `POST /api/import/:source` body: raw store page payload from the extension.
 * Accepts a non-empty object or non-empty array; empty payloads are rejected.
 */
export declare const ImportRequestSchema: z.ZodUnion<readonly [z.ZodRecord<z.ZodString, z.ZodUnknown>, z.ZodArray<z.ZodUnknown>]>;
export declare const ImportResponseSchema: z.ZodObject<{
    inserted: z.ZodNumber;
    updated: z.ZodNumber;
}, z.core.$strip>;
export declare const SyncStateResponseSchema: z.ZodObject<{
    cursor: z.ZodNullable<z.ZodString>;
    lastSyncedAt: z.ZodNullable<z.ZodString>;
}, z.core.$strip>;
export declare const CandidatePairSchema: z.ZodObject<{
    id: z.ZodNumber;
    a: z.ZodObject<{
        source: z.ZodEnum<{
            dlsite: "dlsite";
            fanza_doujin: "fanza_doujin";
            fanza_books: "fanza_books";
            fanza_video: "fanza_video";
            fanza_dlsoft: "fanza_dlsoft";
        }>;
        cid: z.ZodString;
        title: z.ZodString;
        maker: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>;
    b: z.ZodObject<{
        source: z.ZodEnum<{
            dlsite: "dlsite";
            fanza_doujin: "fanza_doujin";
            fanza_books: "fanza_books";
            fanza_video: "fanza_video";
            fanza_dlsoft: "fanza_dlsoft";
        }>;
        cid: z.ZodString;
        title: z.ZodString;
        maker: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>;
    dice: z.ZodNumber;
}, z.core.$strip>;
/** Optional query for `GET /api/candidates`. */
export declare const CandidatesQuerySchema: z.ZodObject<{
    limit: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const CandidatesResponseSchema: z.ZodObject<{
    candidates: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        a: z.ZodObject<{
            source: z.ZodEnum<{
                dlsite: "dlsite";
                fanza_doujin: "fanza_doujin";
                fanza_books: "fanza_books";
                fanza_video: "fanza_video";
                fanza_dlsoft: "fanza_dlsoft";
            }>;
            cid: z.ZodString;
            title: z.ZodString;
            maker: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>;
        b: z.ZodObject<{
            source: z.ZodEnum<{
                dlsite: "dlsite";
                fanza_doujin: "fanza_doujin";
                fanza_books: "fanza_books";
                fanza_video: "fanza_video";
                fanza_dlsoft: "fanza_dlsoft";
            }>;
            cid: z.ZodString;
            title: z.ZodString;
            maker: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strip>;
        dice: z.ZodNumber;
    }, z.core.$strip>>;
}, z.core.$strip>;
/** Path param for `POST /api/candidates/:id`. */
export declare const CandidateIdPathSchema: z.ZodObject<{
    id: z.ZodCoercedNumber<unknown>;
}, z.core.$strip>;
export declare const CandidateDecisionSchema: z.ZodObject<{
    same: z.ZodBoolean;
}, z.core.$strip>;
/** Empty JSON body for endpoints that take no request payload. */
export declare const EmptyRequestSchema: z.ZodObject<{}, z.core.$strict>;
/** Empty success body where the endpoint returns no fields. */
export declare const EmptyResponseSchema: z.ZodObject<{}, z.core.$strict>;
/** `POST /api/rematch` has no request body. */
export declare const RematchRequestSchema: z.ZodObject<{}, z.core.$strict>;
export declare const RematchResponseSchema: z.ZodObject<{
    rematched: z.ZodNumber;
    candidates: z.ZodNumber;
}, z.core.$strip>;
/** Query for `GET /api/listings` (library search / list). */
export declare const ListingsQuerySchema: z.ZodObject<{
    q: z.ZodOptional<z.ZodString>;
    source: z.ZodOptional<z.ZodEnum<{
        dlsite: "dlsite";
        fanza_doujin: "fanza_doujin";
        fanza_books: "fanza_books";
        fanza_video: "fanza_video";
        fanza_dlsoft: "fanza_dlsoft";
    }>>;
    maker: z.ZodOptional<z.ZodString>;
    limit: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
/** One listing row as returned to the management UI. */
export declare const ListingSchema: z.ZodObject<{
    id: z.ZodNumber;
    source: z.ZodEnum<{
        dlsite: "dlsite";
        fanza_doujin: "fanza_doujin";
        fanza_books: "fanza_books";
        fanza_video: "fanza_video";
        fanza_dlsoft: "fanza_dlsoft";
    }>;
    cid: z.ZodString;
    workId: z.ZodNumber;
    workIdLocked: z.ZodOptional<z.ZodBoolean>;
    title: z.ZodString;
    maker: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    seriesId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    imageUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    purchasedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export declare const ListingsResponseSchema: z.ZodObject<{
    listings: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        source: z.ZodEnum<{
            dlsite: "dlsite";
            fanza_doujin: "fanza_doujin";
            fanza_books: "fanza_books";
            fanza_video: "fanza_video";
            fanza_dlsoft: "fanza_dlsoft";
        }>;
        cid: z.ZodString;
        workId: z.ZodNumber;
        workIdLocked: z.ZodOptional<z.ZodBoolean>;
        title: z.ZodString;
        maker: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        seriesId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        imageUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        purchasedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>>;
    total: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const ManualListingRequestSchema: z.ZodObject<{
    url: z.ZodString;
}, z.core.$strip>;
export declare const ManualListingResponseSchema: z.ZodObject<{
    listing: z.ZodObject<{
        id: z.ZodNumber;
        source: z.ZodEnum<{
            dlsite: "dlsite";
            fanza_doujin: "fanza_doujin";
            fanza_books: "fanza_books";
            fanza_video: "fanza_video";
            fanza_dlsoft: "fanza_dlsoft";
        }>;
        cid: z.ZodString;
        workId: z.ZodNumber;
        workIdLocked: z.ZodOptional<z.ZodBoolean>;
        title: z.ZodString;
        maker: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        seriesId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        imageUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        purchasedAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>;
}, z.core.$strip>;
/** Path params for `POST /api/listings/:source/:cid/work`. */
export declare const ListingWorkPathSchema: z.ZodObject<{
    source: z.ZodEnum<{
        dlsite: "dlsite";
        fanza_doujin: "fanza_doujin";
        fanza_books: "fanza_books";
        fanza_video: "fanza_video";
        fanza_dlsoft: "fanza_dlsoft";
    }>;
    cid: z.ZodString;
}, z.core.$strip>;
export declare const WorkAssignmentRequestSchema: z.ZodObject<{
    workId: z.ZodNumber;
    lock: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const WorkAssignmentResponseSchema: z.ZodObject<{
    workId: z.ZodNumber;
    locked: z.ZodBoolean;
}, z.core.$strip>;
export declare const ExportRequestSchema: z.ZodObject<{
    destination: z.ZodString;
}, z.core.$strip>;
export declare const ExportResponseSchema: z.ZodObject<{
    path: z.ZodString;
}, z.core.$strip>;
export type LookupItem = z.infer<typeof LookupItemSchema>;
export type LookupRequest = z.infer<typeof LookupRequestSchema>;
export type LookupResult = z.infer<typeof LookupResultSchema>;
export type LookupResponse = z.infer<typeof LookupResponseSchema>;
export type ImportRequest = z.infer<typeof ImportRequestSchema>;
export type ImportResponse = z.infer<typeof ImportResponseSchema>;
export type ListingsQuery = z.infer<typeof ListingsQuerySchema>;
export type ListingsResponse = z.infer<typeof ListingsResponseSchema>;
//# sourceMappingURL=api.d.ts.map