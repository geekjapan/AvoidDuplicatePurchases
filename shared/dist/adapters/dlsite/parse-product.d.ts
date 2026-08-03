import type { DlsiteProductInfo } from "./types.js";
/**
 * Parse public product.json response (array with one item) via Zod.
 * Required fields are strictly validated; the original item is retained untouched
 * (including unknown future fields such as work_pack_parent).
 */
export declare function parseDlsiteProductJson(raw: unknown): DlsiteProductInfo | null;
//# sourceMappingURL=parse-product.d.ts.map