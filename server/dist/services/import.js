import { parseDlsiteProductJson, dlsiteProductJsonUrl, parseDlsiteSalesPayload, mergeProductInfo, maxSalesCursor, } from "@adp/shared/adapters/dlsite";
import { recomputeMatchKeys } from "./lookup.js";
/** Bound concurrent product.json fetches so first-sync stays within worker lifetime. */
export const PRODUCT_FETCH_CONCURRENCY = 6;
const defaultProductFetcher = async (workno) => {
    try {
        const res = await fetch(dlsiteProductJsonUrl(workno), {
            headers: { "User-Agent": "Mozilla/5.0 (ADP)" },
        });
        if (!res.ok)
            return null;
        return await res.json();
    }
    catch {
        return null;
    }
};
async function mapWithConcurrency(items, concurrency, fn) {
    if (items.length === 0)
        return [];
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
        while (true) {
            const i = next++;
            if (i >= items.length)
                return;
            results[i] = await fn(items[i], i);
        }
    });
    await Promise.all(workers);
    return results;
}
function upsertListing(db, sale, productRaw, now) {
    const product = productRaw ? parseDlsiteProductJson(productRaw) : null;
    const parsed = mergeProductInfo(sale, product);
    const existing = db
        .prepare("SELECT id FROM listing WHERE source = 'dlsite' AND cid = ?")
        .get(parsed.cid);
    if (existing) {
        db.prepare(`UPDATE listing SET
        title = ?, maker_name = ?, series_id = ?, image_url = ?,
        purchased_at = ?, purchased_at_precision = ?, raw_json = ?, imported_at = ?
       WHERE id = ?`).run(parsed.title, parsed.maker, parsed.seriesId, parsed.imageUrl, parsed.purchasedAt, parsed.purchasedAtPrecision, parsed.rawJson, now, existing.id);
        recomputeMatchKeys(db, existing.id);
        return "updated";
    }
    db.prepare("INSERT INTO work DEFAULT VALUES").run();
    const workId = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id);
    db.prepare(`INSERT INTO listing (
      source, cid, work_id, title, maker_name, series_id, image_url,
      purchased_at, purchased_at_precision, raw_json, imported_at
    ) VALUES ('dlsite', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(parsed.cid, workId, parsed.title, parsed.maker, parsed.seriesId, parsed.imageUrl, parsed.purchasedAt, parsed.purchasedAtPrecision, parsed.rawJson, now);
    const listingId = Number(db.prepare("SELECT last_insert_rowid() AS id").get()?.id);
    recomputeMatchKeys(db, listingId);
    return "inserted";
}
function advanceCursor(db, sales, now) {
    const cursor = maxSalesCursor(sales);
    if (!cursor)
        return;
    db.prepare(`INSERT INTO sync_state (source, cursor, last_synced_at) VALUES ('dlsite', ?, ?)
     ON CONFLICT(source) DO UPDATE SET cursor = excluded.cursor, last_synced_at = excluded.last_synced_at`).run(cursor, now);
}
/**
 * Import a DLsite sales batch.
 * Product metadata is fetched with bounded concurrency (deferred relative to parse,
 * not sequential per-row). Cursor advances only after the full batch upserts succeed.
 */
export async function importDlsitePayload(db, raw, fetchProduct = defaultProductFetcher, concurrency = PRODUCT_FETCH_CONCURRENCY) {
    const sales = parseDlsiteSalesPayload(raw);
    const now = new Date().toISOString();
    // Bound enrichment: fetch product.json for the batch with limited concurrency.
    const products = await mapWithConcurrency(sales, concurrency, async (sale) => {
        try {
            return await fetchProduct(sale.workno);
        }
        catch {
            return null;
        }
    });
    let inserted = 0;
    let updated = 0;
    for (let i = 0; i < sales.length; i++) {
        const result = upsertListing(db, sales[i], products[i] ?? null, now);
        if (result === "inserted")
            inserted++;
        else
            updated++;
    }
    // Atomic cursor handling: advance only after all rows in this batch are written.
    advanceCursor(db, sales, now);
    return { inserted, updated };
}
export function seedDlsiteFromSales(db, sales, productByWorkno = {}) {
    let inserted = 0;
    let updated = 0;
    const now = new Date().toISOString();
    for (const sale of sales) {
        const productRaw = productByWorkno[sale.workno.toUpperCase()] ?? productByWorkno[sale.workno];
        const result = upsertListing(db, sale, productRaw ?? null, now);
        if (result === "inserted")
            inserted++;
        else
            updated++;
    }
    advanceCursor(db, sales, now);
    return { inserted, updated };
}
export function getSyncState(db, source) {
    const row = db
        .prepare("SELECT cursor, last_synced_at FROM sync_state WHERE source = ?")
        .get(source);
    if (!row)
        return { cursor: null, lastSyncedAt: null };
    return { cursor: row.cursor, lastSyncedAt: row.last_synced_at };
}
//# sourceMappingURL=import.js.map