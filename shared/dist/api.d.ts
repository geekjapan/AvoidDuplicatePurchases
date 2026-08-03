import { z } from "zod";
export declare const SourceSchema: z.ZodEnum<{
    dlsite: "dlsite";
    fanza_doujin: "fanza_doujin";
    fanza_books: "fanza_books";
    fanza_video: "fanza_video";
    fanza_dlsoft: "fanza_dlsoft";
}>;
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
}, z.core.$strip>;
export declare const LookupResponseSchema: z.ZodObject<{
    results: z.ZodArray<z.ZodObject<{
        owned: z.ZodBoolean;
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
    }, z.core.$strip>>;
}, z.core.$strip>;
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
export declare const CandidateDecisionSchema: z.ZodObject<{
    same: z.ZodBoolean;
}, z.core.$strip>;
export declare const RematchResponseSchema: z.ZodObject<{
    rematched: z.ZodNumber;
    candidates: z.ZodNumber;
}, z.core.$strip>;
export declare const ManualListingRequestSchema: z.ZodObject<{
    url: z.ZodString;
}, z.core.$strip>;
export declare const WorkAssignmentRequestSchema: z.ZodObject<{
    workId: z.ZodNumber;
    lock: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const ExportRequestSchema: z.ZodObject<{
    destination: z.ZodString;
}, z.core.$strip>;
export type LookupItem = z.infer<typeof LookupItemSchema>;
export type LookupRequest = z.infer<typeof LookupRequestSchema>;
export type LookupResult = z.infer<typeof LookupResultSchema>;
export type LookupResponse = z.infer<typeof LookupResponseSchema>;
export type ImportResponse = z.infer<typeof ImportResponseSchema>;
//# sourceMappingURL=api.d.ts.map