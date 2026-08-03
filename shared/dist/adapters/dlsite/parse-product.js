import { isValidDlsiteWorkno } from "./urls.js";
/** Parse public product.json response (array with one item). */
export function parseDlsiteProductJson(raw) {
    const items = Array.isArray(raw) ? raw : null;
    if (!items || items.length === 0)
        return null;
    const item = items[0];
    if (!item || typeof item !== "object")
        return null;
    const rec = item;
    const workno = typeof rec.workno === "string" ? rec.workno.trim() : "";
    const workName = typeof rec.work_name === "string" ? rec.work_name.trim() : "";
    if (!workno || !workName || !isValidDlsiteWorkno(workno))
        return null;
    return {
        workno: workno.toUpperCase(),
        work_name: workName,
        maker_name: typeof rec.maker_name === "string"
            ? rec.maker_name
            : rec.maker_name === null
                ? null
                : undefined,
        series_id: typeof rec.series_id === "string"
            ? rec.series_id
            : rec.series_id === null
                ? null
                : undefined,
        image_url: typeof rec.image_url === "string"
            ? rec.image_url
            : rec.image_url === null
                ? null
                : undefined,
    };
}
//# sourceMappingURL=parse-product.js.map