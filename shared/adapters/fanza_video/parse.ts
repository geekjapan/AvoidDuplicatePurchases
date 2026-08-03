import { z } from "zod";
import type { FanzaVideoParsedListing } from "./types.js";

const VideoItemSchema = z
  .object({
    id: z.string().optional(),
    content: z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      floor: z.string().optional(),
      contentType: z.string().optional(),
      isDiscontinued: z.boolean().optional(),
    }),
    contentItem: z
      .object({
        latestViewingRightsAcquiredAt: z.string().nullable().optional(),
      })
      .optional(),
  })
  .passthrough();

const VideoPageSchema = z.object({
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

function itemEvidence(item: z.infer<typeof VideoItemSchema>): Record<string, unknown> {
  return {
    id: item.id,
    content: item.content,
    contentItem: item.contentItem,
    latestViewingRightsAcquiredAt: item.contentItem?.latestViewingRightsAcquiredAt ?? null,
  };
}

/**
 * Parse GraphQL ppvLibrary page. latestViewingRightsAcquiredAt is raw evidence only —
 * never mapped to purchased_at (spec §4 / §6).
 */
export function parseVideoGraphqlPayload(raw: unknown): FanzaVideoParsedListing[] {
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

export function videoPageHasNext(raw: unknown): boolean {
  const parsed = VideoPageSchema.safeParse(raw);
  if (!parsed.success) return false;
  return parsed.data.data.user.ppvLibrary.contentViewingRightsSummaryList.pageInfo.hasNext === true;
}
