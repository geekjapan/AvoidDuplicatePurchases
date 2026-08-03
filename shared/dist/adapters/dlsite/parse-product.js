import { z } from "zod";
import { isValidDlsiteWorkno } from "./urls.js";
/** Optional product.json field: string, null, or absent. */
const OptionalNullableString = z.union([z.string(), z.null()]).optional();
/** Required derived fields only; unknown keys are validated separately via the original object. */
const DlsiteProductItemSchema = z.object({
    workno: z
        .string()
        .transform((s) => s.trim())
        .refine((s) => s.length > 0, { message: "workno required" })
        .refine((s) => isValidDlsiteWorkno(s), { message: "invalid workno" }),
    work_name: z
        .string()
        .transform((s) => s.trim())
        .refine((s) => s.length > 0, { message: "work_name required" }),
    maker_name: OptionalNullableString,
    series_id: OptionalNullableString,
    image_url: OptionalNullableString,
});
/**
 * Parse public product.json response (array with one item) via Zod.
 * Required fields are strictly validated; the original item is retained untouched
 * (including unknown future fields such as work_pack_parent).
 */
export function parseDlsiteProductJson(raw) {
    if (!Array.isArray(raw) || raw.length === 0)
        return null;
    const original = raw[0];
    if (!original || typeof original !== "object" || Array.isArray(original))
        return null;
    const parsed = DlsiteProductItemSchema.safeParse(original);
    if (!parsed.success)
        return null;
    const item = parsed.data;
    return {
        workno: item.workno.toUpperCase(),
        work_name: item.work_name,
        maker_name: item.maker_name,
        series_id: item.series_id,
        image_url: item.image_url,
        // Untouched evidence object (shallow clone of the original item).
        raw: { ...original },
    };
}
//# sourceMappingURL=parse-product.js.map