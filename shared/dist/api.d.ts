import { z } from "zod";
export declare const SourceSchema: z.ZodEnum<{
    dlsite: "dlsite";
    fanza_doujin: "fanza_doujin";
    fanza_books: "fanza_books";
    fanza_video: "fanza_video";
    fanza_dlsoft: "fanza_dlsoft";
    amazon: "amazon";
    ebookjapan: "ebookjapan";
    kobo: "kobo";
}>;
/** Sources of the DOM library-sync protocol (amazon / ebookjapan / kobo). */
export declare const LibrarySourceSchema: z.ZodEnum<{
    amazon: "amazon";
    ebookjapan: "ebookjapan";
    kobo: "kobo";
}>;
/** Explicit acquisition/access state vocabulary carried by library items. */
export declare const LibraryItemStateSchema: z.ZodEnum<{
    purchased: "purchased";
    free: "free";
    rental: "rental";
    sample: "sample";
    preview: "preview";
    subscription: "subscription";
    gift: "gift";
    reservation: "reservation";
    unknown: "unknown";
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
        amazon: "amazon";
        ebookjapan: "ebookjapan";
        kobo: "kobo";
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
            amazon: "amazon";
            ebookjapan: "ebookjapan";
            kobo: "kobo";
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
        amazon: "amazon";
        ebookjapan: "ebookjapan";
        kobo: "kobo";
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
            amazon: "amazon";
            ebookjapan: "ebookjapan";
            kobo: "kobo";
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
            amazon: "amazon";
            ebookjapan: "ebookjapan";
            kobo: "kobo";
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
                amazon: "amazon";
                ebookjapan: "ebookjapan";
                kobo: "kobo";
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
                amazon: "amazon";
                ebookjapan: "ebookjapan";
                kobo: "kobo";
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
        amazon: "amazon";
        ebookjapan: "ebookjapan";
        kobo: "kobo";
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
/**
 * `latestOutcome` shape of the sync-state responses (identity fields stripped
 * by the server). `counts` is always present; `error` / `fetched` are the
 * per-run failure/volume evidence, never inferred values.
 */
export declare const SyncOutcomeSchema: z.ZodObject<{
    ok: z.ZodBoolean;
    counts: z.ZodObject<{
        inserted: z.ZodNumber;
        updated: z.ZodNumber;
    }, z.core.$strict>;
    error: z.ZodNullable<z.ZodString>;
    fetched: z.ZodNullable<z.ZodNumber>;
    recordedAt: z.ZodString;
}, z.core.$strict>;
/**
 * `GET|POST /api/sync-state/:source` response. Strict: unknown keys and
 * malformed/missing `latestOutcome` fail closed at every client boundary.
 */
export declare const SyncStateResponseSchema: z.ZodObject<{
    cursor: z.ZodNullable<z.ZodString>;
    lastSyncedAt: z.ZodNullable<z.ZodString>;
    latestOutcome: z.ZodNullable<z.ZodObject<{
        ok: z.ZodBoolean;
        counts: z.ZodObject<{
            inserted: z.ZodNumber;
            updated: z.ZodNumber;
        }, z.core.$strict>;
        error: z.ZodNullable<z.ZodString>;
        fetched: z.ZodNullable<z.ZodNumber>;
        recordedAt: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const CandidatePairSchema: z.ZodObject<{
    id: z.ZodNumber;
    a: z.ZodObject<{
        source: z.ZodEnum<{
            dlsite: "dlsite";
            fanza_doujin: "fanza_doujin";
            fanza_books: "fanza_books";
            fanza_video: "fanza_video";
            fanza_dlsoft: "fanza_dlsoft";
            amazon: "amazon";
            ebookjapan: "ebookjapan";
            kobo: "kobo";
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
            amazon: "amazon";
            ebookjapan: "ebookjapan";
            kobo: "kobo";
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
                amazon: "amazon";
                ebookjapan: "ebookjapan";
                kobo: "kobo";
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
                amazon: "amazon";
                ebookjapan: "ebookjapan";
                kobo: "kobo";
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
/**
 * A store-reported money value. The schema intentionally models minor units
 * and tax semantics without doing currency conversion or tax inference.
 */
export declare const MoneySchema: z.ZodObject<{
    amountMinor: z.ZodNumber;
    currency: z.ZodString;
    taxStatus: z.ZodEnum<{
        unknown: "unknown";
        included: "included";
        excluded: "excluded";
    }>;
}, z.core.$strict>;
/** A current-price snapshot obtained at a known UTC observation time. */
export declare const CurrentPriceSchema: z.ZodObject<{
    amountMinor: z.ZodNumber;
    currency: z.ZodString;
    taxStatus: z.ZodEnum<{
        unknown: "unknown";
        included: "included";
        excluded: "excluded";
    }>;
    observedAt: z.ZodString;
    provenance: z.ZodEnum<{
        store_product_metadata: "store_product_metadata";
        store_library_metadata: "store_library_metadata";
    }>;
}, z.core.$strict>;
/**
 * Visible-DOM three-tier price observation (issue #45).
 * Tiers are independent; missing/ambiguous stay null. Never calculated.
 * `observedAt` is the server receipt instant (UTC), not a sale/coupon deadline.
 */
export declare const PriceObservationSchema: z.ZodObject<{
    regular: z.ZodNullable<z.ZodObject<{
        amountMinor: z.ZodNumber;
        taxStatus: z.ZodEnum<{
            unknown: "unknown";
            included: "included";
            excluded: "excluded";
        }>;
        currency: z.ZodLiteral<"JPY">;
    }, z.core.$strict>>;
    sale: z.ZodNullable<z.ZodObject<{
        amountMinor: z.ZodNumber;
        taxStatus: z.ZodEnum<{
            unknown: "unknown";
            included: "included";
            excluded: "excluded";
        }>;
        currency: z.ZodLiteral<"JPY">;
    }, z.core.$strict>>;
    coupon: z.ZodNullable<z.ZodObject<{
        amountMinor: z.ZodNumber;
        taxStatus: z.ZodEnum<{
            unknown: "unknown";
            included: "included";
            excluded: "excluded";
        }>;
        currency: z.ZodLiteral<"JPY">;
    }, z.core.$strict>>;
    observedAt: z.ZodString;
}, z.core.$strict>;
/**
 * Extension → server payload for an owned listing's visible product-page prices.
 * Server stamps `observedAt`; client must not send purchasePrice.
 */
export declare const PriceObservationRequestSchema: z.ZodObject<{
    source: z.ZodEnum<{
        dlsite: "dlsite";
        fanza_doujin: "fanza_doujin";
        fanza_books: "fanza_books";
        fanza_video: "fanza_video";
        fanza_dlsoft: "fanza_dlsoft";
        amazon: "amazon";
        ebookjapan: "ebookjapan";
        kobo: "kobo";
    }>;
    cid: z.ZodString;
    pageUrl: z.ZodString;
    regular: z.ZodNullable<z.ZodObject<{
        amountMinor: z.ZodNumber;
        taxStatus: z.ZodEnum<{
            unknown: "unknown";
            included: "included";
            excluded: "excluded";
        }>;
        currency: z.ZodLiteral<"JPY">;
    }, z.core.$strict>>;
    sale: z.ZodNullable<z.ZodObject<{
        amountMinor: z.ZodNumber;
        taxStatus: z.ZodEnum<{
            unknown: "unknown";
            included: "included";
            excluded: "excluded";
        }>;
        currency: z.ZodLiteral<"JPY">;
    }, z.core.$strict>>;
    coupon: z.ZodNullable<z.ZodObject<{
        amountMinor: z.ZodNumber;
        taxStatus: z.ZodEnum<{
            unknown: "unknown";
            included: "included";
            excluded: "excluded";
        }>;
        currency: z.ZodLiteral<"JPY">;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const PriceObservationResponseSchema: z.ZodObject<{
    ok: z.ZodLiteral<true>;
    priceObservation: z.ZodObject<{
        regular: z.ZodNullable<z.ZodObject<{
            amountMinor: z.ZodNumber;
            taxStatus: z.ZodEnum<{
                unknown: "unknown";
                included: "included";
                excluded: "excluded";
            }>;
            currency: z.ZodLiteral<"JPY">;
        }, z.core.$strict>>;
        sale: z.ZodNullable<z.ZodObject<{
            amountMinor: z.ZodNumber;
            taxStatus: z.ZodEnum<{
                unknown: "unknown";
                included: "included";
                excluded: "excluded";
            }>;
            currency: z.ZodLiteral<"JPY">;
        }, z.core.$strict>>;
        coupon: z.ZodNullable<z.ZodObject<{
            amountMinor: z.ZodNumber;
            taxStatus: z.ZodEnum<{
                unknown: "unknown";
                included: "included";
                excluded: "excluded";
            }>;
            currency: z.ZodLiteral<"JPY">;
        }, z.core.$strict>>;
        observedAt: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
/**
 * One DOM-observed library item of the typed library-sync protocol.
 * The schema is strict and carries no price fields: Amazon/ebookjapan/Kobo
 * price values stay null/未取得 until a later price contract is defined.
 * `state` is reader-supplied evidence; the server never infers it.
 */
export declare const LibraryImportItemSchema: z.ZodObject<{
    cid: z.ZodString;
    title: z.ZodString;
    state: z.ZodEnum<{
        purchased: "purchased";
        free: "free";
        rental: "rental";
        sample: "sample";
        preview: "preview";
        subscription: "subscription";
        gift: "gift";
        reservation: "reservation";
        unknown: "unknown";
    }>;
    maker: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    seriesId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    imageUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    productUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strict>;
/**
 * `POST /api/import/library` body: one bounded visible batch with the page
 * the batch was read from. `pageUrl` must be absolute https (the DOM sync
 * protocol never reads private-network or non-https pages).
 * The generic layer preserves every state verbatim; ownership mapping is a
 * provider-task concern and never happens here.
 */
export declare const LibraryImportRequestSchema: z.ZodObject<{
    source: z.ZodEnum<{
        amazon: "amazon";
        ebookjapan: "ebookjapan";
        kobo: "kobo";
    }>;
    pageUrl: z.ZodString;
    items: z.ZodArray<z.ZodObject<{
        cid: z.ZodString;
        title: z.ZodString;
        state: z.ZodEnum<{
            purchased: "purchased";
            free: "free";
            rental: "rental";
            sample: "sample";
            preview: "preview";
            subscription: "subscription";
            gift: "gift";
            reservation: "reservation";
            unknown: "unknown";
        }>;
        maker: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        seriesId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        imageUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        productUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const LibraryImportResponseSchema: z.ZodObject<{
    observed: z.ZodNumber;
    inserted: z.ZodNumber;
    updated: z.ZodNumber;
    byState: z.ZodObject<{
        purchased: z.ZodNumber;
        free: z.ZodNumber;
        rental: z.ZodNumber;
        sample: z.ZodNumber;
        preview: z.ZodNumber;
        subscription: z.ZodNumber;
        gift: z.ZodNumber;
        reservation: z.ZodNumber;
        unknown: z.ZodNumber;
    }, z.core.$strict>;
}, z.core.$strict>;
/**
 * Sort keys for `GET /api/listings`.
 * Price sorts use stored `priceObservation` tiers only — never
 * `purchasePrice` / `currentPrice` inventions.
 */
export declare const ListingsSortSchema: z.ZodEnum<{
    work: "work";
    title_asc: "title_asc";
    title_desc: "title_desc";
    purchased_at_asc: "purchased_at_asc";
    purchased_at_desc: "purchased_at_desc";
    price_observation_asc: "price_observation_asc";
    price_observation_desc: "price_observation_desc";
}>;
/** Which `priceObservation` tier a currency filter or price sort uses. */
export declare const PriceObservationTierSchema: z.ZodEnum<{
    regular: "regular";
    sale: "sale";
    coupon: "coupon";
}>;
/**
 * Query for `GET /api/listings` (library search / list).
 *
 * Price-related parameters consult only persisted `priceObservation` values.
 * `purchasePrice` and `currentPrice` are never used for filter/sort.
 * `price_observation_*` sorts require both `priceCurrency` and `priceTier`
 * so amounts are never ordered across currencies or invented tiers.
 */
export declare const ListingsQuerySchema: z.ZodObject<{
    q: z.ZodOptional<z.ZodString>;
    source: z.ZodOptional<z.ZodEnum<{
        dlsite: "dlsite";
        fanza_doujin: "fanza_doujin";
        fanza_books: "fanza_books";
        fanza_video: "fanza_video";
        fanza_dlsoft: "fanza_dlsoft";
        amazon: "amazon";
        ebookjapan: "ebookjapan";
        kobo: "kobo";
    }>>;
    maker: z.ZodOptional<z.ZodString>;
    priceCurrency: z.ZodOptional<z.ZodString>;
    priceTier: z.ZodOptional<z.ZodEnum<{
        regular: "regular";
        sale: "sale";
        coupon: "coupon";
    }>>;
    sort: z.ZodOptional<z.ZodEnum<{
        work: "work";
        title_asc: "title_asc";
        title_desc: "title_desc";
        purchased_at_asc: "purchased_at_asc";
        purchased_at_desc: "purchased_at_desc";
        price_observation_asc: "price_observation_asc";
        price_observation_desc: "price_observation_desc";
    }>>;
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
        amazon: "amazon";
        ebookjapan: "ebookjapan";
        kobo: "kobo";
    }>;
    cid: z.ZodString;
    workId: z.ZodNumber;
    workIdLocked: z.ZodBoolean;
    title: z.ZodString;
    maker: z.ZodNullable<z.ZodString>;
    seriesId: z.ZodNullable<z.ZodString>;
    imageUrl: z.ZodNullable<z.ZodString>;
    imageProvenance: z.ZodNullable<z.ZodEnum<{
        store_product_metadata: "store_product_metadata";
        store_library_metadata: "store_library_metadata";
    }>>;
    productUrl: z.ZodNullable<z.ZodString>;
    productUrlProvenance: z.ZodNullable<z.ZodEnum<{
        store_canonical: "store_canonical";
        verified_derived: "verified_derived";
    }>>;
    purchasedAt: z.ZodNullable<z.ZodString>;
    purchasedAtPrecision: z.ZodEnum<{
        unknown: "unknown";
        second: "second";
        day: "day";
    }>;
    purchasePrice: z.ZodNullable<z.ZodObject<{
        amountMinor: z.ZodNumber;
        currency: z.ZodString;
        taxStatus: z.ZodEnum<{
            unknown: "unknown";
            included: "included";
            excluded: "excluded";
        }>;
    }, z.core.$strict>>;
    currentPrice: z.ZodNullable<z.ZodObject<{
        amountMinor: z.ZodNumber;
        currency: z.ZodString;
        taxStatus: z.ZodEnum<{
            unknown: "unknown";
            included: "included";
            excluded: "excluded";
        }>;
        observedAt: z.ZodString;
        provenance: z.ZodEnum<{
            store_product_metadata: "store_product_metadata";
            store_library_metadata: "store_library_metadata";
        }>;
    }, z.core.$strict>>;
    priceObservation: z.ZodNullable<z.ZodObject<{
        regular: z.ZodNullable<z.ZodObject<{
            amountMinor: z.ZodNumber;
            taxStatus: z.ZodEnum<{
                unknown: "unknown";
                included: "included";
                excluded: "excluded";
            }>;
            currency: z.ZodLiteral<"JPY">;
        }, z.core.$strict>>;
        sale: z.ZodNullable<z.ZodObject<{
            amountMinor: z.ZodNumber;
            taxStatus: z.ZodEnum<{
                unknown: "unknown";
                included: "included";
                excluded: "excluded";
            }>;
            currency: z.ZodLiteral<"JPY">;
        }, z.core.$strict>>;
        coupon: z.ZodNullable<z.ZodObject<{
            amountMinor: z.ZodNumber;
            taxStatus: z.ZodEnum<{
                unknown: "unknown";
                included: "included";
                excluded: "excluded";
            }>;
            currency: z.ZodLiteral<"JPY">;
        }, z.core.$strict>>;
        observedAt: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const ListingsResponseSchema: z.ZodObject<{
    listings: z.ZodArray<z.ZodObject<{
        id: z.ZodNumber;
        source: z.ZodEnum<{
            dlsite: "dlsite";
            fanza_doujin: "fanza_doujin";
            fanza_books: "fanza_books";
            fanza_video: "fanza_video";
            fanza_dlsoft: "fanza_dlsoft";
            amazon: "amazon";
            ebookjapan: "ebookjapan";
            kobo: "kobo";
        }>;
        cid: z.ZodString;
        workId: z.ZodNumber;
        workIdLocked: z.ZodBoolean;
        title: z.ZodString;
        maker: z.ZodNullable<z.ZodString>;
        seriesId: z.ZodNullable<z.ZodString>;
        imageUrl: z.ZodNullable<z.ZodString>;
        imageProvenance: z.ZodNullable<z.ZodEnum<{
            store_product_metadata: "store_product_metadata";
            store_library_metadata: "store_library_metadata";
        }>>;
        productUrl: z.ZodNullable<z.ZodString>;
        productUrlProvenance: z.ZodNullable<z.ZodEnum<{
            store_canonical: "store_canonical";
            verified_derived: "verified_derived";
        }>>;
        purchasedAt: z.ZodNullable<z.ZodString>;
        purchasedAtPrecision: z.ZodEnum<{
            unknown: "unknown";
            second: "second";
            day: "day";
        }>;
        purchasePrice: z.ZodNullable<z.ZodObject<{
            amountMinor: z.ZodNumber;
            currency: z.ZodString;
            taxStatus: z.ZodEnum<{
                unknown: "unknown";
                included: "included";
                excluded: "excluded";
            }>;
        }, z.core.$strict>>;
        currentPrice: z.ZodNullable<z.ZodObject<{
            amountMinor: z.ZodNumber;
            currency: z.ZodString;
            taxStatus: z.ZodEnum<{
                unknown: "unknown";
                included: "included";
                excluded: "excluded";
            }>;
            observedAt: z.ZodString;
            provenance: z.ZodEnum<{
                store_product_metadata: "store_product_metadata";
                store_library_metadata: "store_library_metadata";
            }>;
        }, z.core.$strict>>;
        priceObservation: z.ZodNullable<z.ZodObject<{
            regular: z.ZodNullable<z.ZodObject<{
                amountMinor: z.ZodNumber;
                taxStatus: z.ZodEnum<{
                    unknown: "unknown";
                    included: "included";
                    excluded: "excluded";
                }>;
                currency: z.ZodLiteral<"JPY">;
            }, z.core.$strict>>;
            sale: z.ZodNullable<z.ZodObject<{
                amountMinor: z.ZodNumber;
                taxStatus: z.ZodEnum<{
                    unknown: "unknown";
                    included: "included";
                    excluded: "excluded";
                }>;
                currency: z.ZodLiteral<"JPY">;
            }, z.core.$strict>>;
            coupon: z.ZodNullable<z.ZodObject<{
                amountMinor: z.ZodNumber;
                taxStatus: z.ZodEnum<{
                    unknown: "unknown";
                    included: "included";
                    excluded: "excluded";
                }>;
                currency: z.ZodLiteral<"JPY">;
            }, z.core.$strict>>;
            observedAt: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    total: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
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
            amazon: "amazon";
            ebookjapan: "ebookjapan";
            kobo: "kobo";
        }>;
        cid: z.ZodString;
        workId: z.ZodNumber;
        workIdLocked: z.ZodBoolean;
        title: z.ZodString;
        maker: z.ZodNullable<z.ZodString>;
        seriesId: z.ZodNullable<z.ZodString>;
        imageUrl: z.ZodNullable<z.ZodString>;
        imageProvenance: z.ZodNullable<z.ZodEnum<{
            store_product_metadata: "store_product_metadata";
            store_library_metadata: "store_library_metadata";
        }>>;
        productUrl: z.ZodNullable<z.ZodString>;
        productUrlProvenance: z.ZodNullable<z.ZodEnum<{
            store_canonical: "store_canonical";
            verified_derived: "verified_derived";
        }>>;
        purchasedAt: z.ZodNullable<z.ZodString>;
        purchasedAtPrecision: z.ZodEnum<{
            unknown: "unknown";
            second: "second";
            day: "day";
        }>;
        purchasePrice: z.ZodNullable<z.ZodObject<{
            amountMinor: z.ZodNumber;
            currency: z.ZodString;
            taxStatus: z.ZodEnum<{
                unknown: "unknown";
                included: "included";
                excluded: "excluded";
            }>;
        }, z.core.$strict>>;
        currentPrice: z.ZodNullable<z.ZodObject<{
            amountMinor: z.ZodNumber;
            currency: z.ZodString;
            taxStatus: z.ZodEnum<{
                unknown: "unknown";
                included: "included";
                excluded: "excluded";
            }>;
            observedAt: z.ZodString;
            provenance: z.ZodEnum<{
                store_product_metadata: "store_product_metadata";
                store_library_metadata: "store_library_metadata";
            }>;
        }, z.core.$strict>>;
        priceObservation: z.ZodNullable<z.ZodObject<{
            regular: z.ZodNullable<z.ZodObject<{
                amountMinor: z.ZodNumber;
                taxStatus: z.ZodEnum<{
                    unknown: "unknown";
                    included: "included";
                    excluded: "excluded";
                }>;
                currency: z.ZodLiteral<"JPY">;
            }, z.core.$strict>>;
            sale: z.ZodNullable<z.ZodObject<{
                amountMinor: z.ZodNumber;
                taxStatus: z.ZodEnum<{
                    unknown: "unknown";
                    included: "included";
                    excluded: "excluded";
                }>;
                currency: z.ZodLiteral<"JPY">;
            }, z.core.$strict>>;
            coupon: z.ZodNullable<z.ZodObject<{
                amountMinor: z.ZodNumber;
                taxStatus: z.ZodEnum<{
                    unknown: "unknown";
                    included: "included";
                    excluded: "excluded";
                }>;
                currency: z.ZodLiteral<"JPY">;
            }, z.core.$strict>>;
            observedAt: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>;
}, z.core.$strip>;
/** Path params for `POST /api/listings/:source/:cid/work`. */
export declare const ListingWorkPathSchema: z.ZodObject<{
    source: z.ZodEnum<{
        dlsite: "dlsite";
        fanza_doujin: "fanza_doujin";
        fanza_books: "fanza_books";
        fanza_video: "fanza_video";
        fanza_dlsoft: "fanza_dlsoft";
        amazon: "amazon";
        ebookjapan: "ebookjapan";
        kobo: "kobo";
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
//# sourceMappingURL=api.d.ts.map