import { z } from "zod";
const NonBlankString = z.string().trim().min(1);
const DoujinItemSchema = z.object({
    contentId: NonBlankString,
    productId: z.string().optional(),
    title: NonBlankString,
    makerName: z.string().optional(),
    genre: z.string().optional(),
    imageSrc: z.string().optional(),
});
const DoujinPageSchema = z.object({
    error_code: z.literal(0),
    data: z.object({
        items: z.record(z.string(), z.array(DoujinItemSchema)),
        total: z.number().optional(),
        hasNext: z.boolean().optional(),
    }),
});
/** Parse Japanese calendar date key `YYYY年MM月DD日` → `YYYY-MM-DD`. */
export function parseJpDateKey(key) {
    const m = /^(\d{4})年(\d{2})月(\d{2})日$/.exec(key.trim());
    if (!m)
        return null;
    return `${m[1]}-${m[2]}-${m[3]}`;
}
function itemEvidence(item, dateKey) {
    return {
        contentId: item.contentId,
        productId: item.productId,
        title: item.title,
        makerName: item.makerName,
        genre: item.genre,
        imageSrc: item.imageSrc,
        purchasedDateKey: dateKey,
    };
}
function listingFromItem(item, dateKey) {
    const purchasedDay = parseJpDateKey(dateKey);
    const maker = typeof item.makerName === "string" && item.makerName.trim() ? item.makerName.trim() : null;
    const imageUrl = typeof item.imageSrc === "string" && item.imageSrc.trim() ? item.imageSrc.trim() : null;
    return {
        cid: item.contentId.trim(),
        title: item.title.trim(),
        maker,
        seriesId: null,
        imageUrl,
        purchasedAt: purchasedDay,
        purchasedAtPrecision: "day",
        rawJson: JSON.stringify({ sale: itemEvidence(item, dateKey) }),
    };
}
/** Parse one mylibraries page payload into listing stubs (day-precision purchased_at). */
export function parseDoujinMylibrariesPayload(raw) {
    const parsed = DoujinPageSchema.safeParse(raw);
    if (!parsed.success) {
        throw new Error("fanza_doujin payload failed schema validation");
    }
    const out = [];
    for (const [dateKey, items] of Object.entries(parsed.data.data.items)) {
        for (const item of items) {
            out.push(listingFromItem(item, dateKey));
        }
    }
    return out;
}
export function doujinPageHasNext(raw) {
    const parsed = DoujinPageSchema.safeParse(raw);
    if (!parsed.success)
        return false;
    return parsed.data.data.hasNext === true;
}
//# sourceMappingURL=parse.js.map