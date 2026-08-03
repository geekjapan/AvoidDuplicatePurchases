import { makerMatchKey, titleMatchKey, dice, normalizeCid, } from "@adp/shared";
import { productUrlForSource } from "@adp/shared/adapters/dlsite";
export function hasListing(db, source, cid) {
    const row = db
        .prepare("SELECT 1 FROM listing WHERE source = ? AND cid = ?")
        .get(source, cid);
    return row !== undefined;
}
export function lookupItems(db, items) {
    return items.map((item) => lookupOne(db, item));
}
function lookupOne(db, item) {
    let owned = false;
    if (item.source && item.cid) {
        const cid = normalizeCid(item.source, item.cid);
        owned = hasListing(db, item.source, cid);
    }
    const other = [];
    if (item.title) {
        const titleKey = titleMatchKey(item.title);
        const makerKey = item.maker ? makerMatchKey(item.maker) : "";
        const rows = db
            .prepare(`SELECT l.id, l.source, l.cid, l.title, l.maker_name
         FROM match_key mk
         JOIN listing l ON l.id = mk.listing_id
         WHERE mk.kind = 'title' AND mk.key = ?`)
            .all(titleKey);
        for (const row of rows) {
            if (item.source &&
                item.cid &&
                row.source === item.source &&
                row.cid === normalizeCid(item.source, item.cid)) {
                continue;
            }
            if (makerKey) {
                const rowMakerKey = makerMatchKey(row.maker_name);
                if (!rowMakerKey || rowMakerKey !== makerKey)
                    continue;
            }
            other.push({
                source: row.source,
                cid: row.cid,
                title: row.title,
                url: productUrlForSource(row.source, row.cid),
            });
        }
    }
    return { owned, other };
}
export function recomputeMatchKeys(db, listingId) {
    const row = db
        .prepare("SELECT id, title, maker_name FROM listing WHERE id = ?")
        .get(listingId);
    if (!row)
        return;
    db.prepare("DELETE FROM match_key WHERE listing_id = ?").run(listingId);
    const titleKey = titleMatchKey(row.title);
    if (titleKey) {
        db.prepare("INSERT INTO match_key (listing_id, kind, key) VALUES (?, 'title', ?)").run(listingId, titleKey);
    }
    const makerKey = makerMatchKey(row.maker_name);
    if (makerKey) {
        db.prepare("INSERT INTO match_key (listing_id, kind, key) VALUES (?, 'maker', ?)").run(listingId, makerKey);
    }
}
export function runRematch(db) {
    const listings = db
        .prepare(`SELECT id, work_id, work_id_locked, title, maker_name, source, cid
       FROM listing ORDER BY id`)
        .all();
    for (const listing of listings) {
        recomputeMatchKeys(db, listing.id);
    }
    let rematched = 0;
    const unlocked = listings.filter((l) => l.work_id_locked === 0);
    const groups = new Map();
    for (const listing of unlocked) {
        const key = titleMatchKey(listing.title);
        const ids = groups.get(key) ?? [];
        ids.push(listing.id);
        groups.set(key, ids);
    }
    for (const ids of groups.values()) {
        if (ids.length < 2)
            continue;
        const workIds = new Set(ids.map((id) => {
            const row = db.prepare("SELECT work_id FROM listing WHERE id = ?").get(id);
            return row.work_id;
        }));
        if (workIds.size <= 1)
            continue;
        const targetWorkId = Math.min(...workIds);
        for (const id of ids) {
            const row = db.prepare("SELECT work_id FROM listing WHERE id = ?").get(id);
            if (row.work_id !== targetWorkId) {
                db.prepare("UPDATE listing SET work_id = ? WHERE id = ? AND work_id_locked = 0").run(targetWorkId, id);
                rematched++;
            }
        }
    }
    db.exec("DELETE FROM candidate");
    let candidates = 0;
    const allListings = db
        .prepare("SELECT id, title, maker_name, source, cid FROM listing ORDER BY id")
        .all();
    for (let i = 0; i < allListings.length; i++) {
        for (let j = i + 1; j < allListings.length; j++) {
            const a = allListings[i];
            const b = allListings[j];
            if (a.source === b.source && a.cid === b.cid)
                continue;
            const makerA = makerMatchKey(a.maker_name);
            const makerB = makerMatchKey(b.maker_name);
            if (!makerA || !makerB || makerA !== makerB)
                continue;
            const titleA = titleMatchKey(a.title);
            const titleB = titleMatchKey(b.title);
            if (titleA === titleB)
                continue;
            const score = dice(titleA, titleB);
            if (score < 0.7)
                continue;
            db.prepare("INSERT OR IGNORE INTO candidate (listing_a_id, listing_b_id, dice) VALUES (?, ?, ?)").run(a.id, b.id, score);
            candidates++;
        }
    }
    return { rematched, candidates };
}
//# sourceMappingURL=lookup.js.map