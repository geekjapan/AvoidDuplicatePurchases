import { z } from "zod";
import { isValidDlsiteWorkno } from "./urls.js";
/** Optional product.json field: string, null, or absent. */
const OptionalNullableString = z.union([z.string(), z.null()]).optional();
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
const DlsiteProductJsonSchema = z.array(DlsiteProductItemSchema).min(1);
/** Parse public product.json response (array with one item) via Zod. */
export function parseDlsiteProductJson(raw) {
    const parsed = DlsiteProductJsonSchema.safeParse(raw);
    if (!parsed.success)
        return null;
    const item = parsed.data[0];
    return {
        workno: item.workno.toUpperCase(),
        work_name: item.work_name,
        maker_name: item.maker_name,
        series_id: item.series_id,
        image_url: item.image_url,
    };
}
//# sourceMappingURL=parse-product.js.map