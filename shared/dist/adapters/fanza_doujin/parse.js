import { z } from "zod";
const NonBlankString = z.string().trim().min(1);
const DoujinItemSchema = z
    .object({
    contentId: NonBlankString,
    productId: z.string().optional(),
    title: NonBlankString,
    makerName: z.string().optional(),
    genre: z.string().optional(),
    imageSrc: z.string().optional(),
})
    .passthrough();
const DoujinPageSchema = z.object({
    error_code: z.literal(0),
    data: z.object({
        items: z.record(z.string(), z.array(DoujinItemSchema)),
        total: z.number().optional(),
        hasNext: z.boolean().optional(),
    }),
});
/** Parse Japanese calendar date key `YYYY年MM月DD日` → valid `YYYY-MM-DD` only. */
export function parseJpDateKey(key) {
    const m = /^(\d{4})年(\d{2})月(\d{2})日$/.exec(key.trim());
    if (!m)
        return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        return null;
    }
    if (month < 1 || month > 12 || day < 1 || day > 31)
        return null;
    // Reject impossible calendar dates (e.g. Feb 30, Apr 31) while accepting leap days.
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year ||
        probe.getUTCMonth() !== month - 1 ||
        probe.getUTCDate() !== day) {
        return null;
    }
    return `${m[1]}-${m[2]}-${m[3]}`;
}
function itemEvidence(item, dateKey) {
    return {
        ...item,
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
/** Validated pagination metadata for the server import boundary. */
export function doujinPageInfo(raw) {
    const parsed = DoujinPageSchema.safeParse(raw);
    if (!parsed.success) {
        throw new Error("fanza_doujin payload failed schema validation");
    }
    let itemCount = 0;
    for (const items of Object.values(parsed.data.data.items)) {
        itemCount += items.length;
    }
    const hasNext = parsed.data.data.hasNext === true;
    return {
        itemCount,
        totalCount: parsed.data.data.total ?? itemCount,
        hasNext,
    };
}
//# sourceMappingURL=parse.js.map