import { z } from "zod";
const NonBlankString = z.string().trim().min(1);
const VideoItemSchema = z
    .object({
    id: z.string().optional(),
    content: z.object({
        id: NonBlankString,
        title: NonBlankString,
        floor: z.string().optional(),
        contentType: z.string().optional(),
        isDiscontinued: z.boolean().optional(),
    }).passthrough(),
    contentItem: z
        .object({
        latestViewingRightsAcquiredAt: z.string().nullable().optional(),
    })
        .passthrough()
        .optional(),
})
    .passthrough();
const VideoPageSchema = z.object({
    errors: z.array(z.unknown()).max(0).optional(),
    data: z.object({
        user: z.object({
            ppvLibrary: z.object({
                contentViewingRightsSummaryList: z.object({
                    pageInfo: z.object({
                        hasNext: z.boolean().optional(),
                        totalCount: z.number().optional(),
                    }),
                    items: z.array(VideoItemSchema),
                }),
            }),
        }),
    }),
});
function itemEvidence(item) {
    return {
        ...item,
        // Keep the established flat evidence path while retaining the untouched item.
        latestViewingRightsAcquiredAt: item.contentItem?.latestViewingRightsAcquiredAt ?? null,
    };
}
/**
 * Parse GraphQL ppvLibrary page. latestViewingRightsAcquiredAt is raw evidence only —
 * never mapped to purchased_at (spec §4 / §6).
 */
export function parseVideoGraphqlPayload(raw) {
    const parsed = VideoPageSchema.safeParse(raw);
    if (!parsed.success) {
        throw new Error("fanza_video payload failed schema validation");
    }
    return parsed.data.data.user.ppvLibrary.contentViewingRightsSummaryList.items.map((item) => ({
        cid: item.content.id.trim(),
        title: item.content.title.trim(),
        maker: null,
        seriesId: null,
        imageUrl: null,
        purchasedAt: null,
        purchasedAtPrecision: "unknown",
        rawJson: JSON.stringify({ sale: itemEvidence(item) }),
    }));
}
export function videoPageHasNext(raw) {
    const parsed = VideoPageSchema.safeParse(raw);
    if (!parsed.success)
        return false;
    return parsed.data.data.user.ppvLibrary.contentViewingRightsSummaryList.pageInfo.hasNext === true;
}
/** Validated pagination metadata for the server import boundary. */
export function videoPageInfo(raw) {
    const parsed = VideoPageSchema.safeParse(raw);
    if (!parsed.success) {
        throw new Error("fanza_video payload failed schema validation");
    }
    const list = parsed.data.data.user.ppvLibrary.contentViewingRightsSummaryList;
    const itemCount = list.items.length;
    const hasNext = list.pageInfo.hasNext === true;
    return {
        itemCount,
        totalCount: list.pageInfo.totalCount ?? itemCount,
        hasNext,
    };
}
//# sourceMappingURL=parse.js.map