import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { type ProductFetcher } from "./services/import.js";
export interface ApiContext {
    db: DatabaseSync;
    port: number;
    /** Exact chrome-extension:// origins allowed (from ADP_EXTENSION_ORIGIN). */
    extensionOrigins?: ReadonlySet<string>;
    productFetcher?: ProductFetcher;
}
export declare function handleApi(req: IncomingMessage, res: ServerResponse, ctx: ApiContext): Promise<boolean>;
//# sourceMappingURL=http.d.ts.map