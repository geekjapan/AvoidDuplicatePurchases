/**
 * Cart delete/restore request builders for intervention stores (Issue #9).
 * URL/payload assembly only — no network calls.
 */
const JSON_HEADERS = {
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
};
export function dlsiteDelete(workno) {
    return {
        url: `https://www.dlsite.com/maniax/cart/ajax/=/mode/nothanks/product_id/${workno}`,
        method: "GET",
        headers: {},
    };
}
export function dlsiteRestore(workno) {
    return {
        url: `https://www.dlsite.com/maniax/cart/ajax/=/mode/cart/obj_nocheck/1/product_id/${workno}`,
        method: "GET",
        headers: {},
    };
}
export function doujinDelete(cids, csrfToken) {
    return {
        url: "https://www.dmm.co.jp/dc/doujin/api/baskets/",
        method: "DELETE",
        headers: { ...JSON_HEADERS },
        body: JSON.stringify({ product_ids: cids, _token: csrfToken }),
    };
}
export function doujinRestore(cid, csrfToken) {
    return {
        url: "https://www.dmm.co.jp/dc/doujin/api/baskets/",
        method: "POST",
        headers: { ...JSON_HEADERS },
        body: JSON.stringify({ product_id: cid, _token: csrfToken }),
    };
}
export function booksDelete(cids, ownUrl = "https://book.dmm.co.jp/basket/") {
    return {
        url: "https://book.dmm.co.jp/ajax/basket/delete",
        method: "POST",
        headers: { ...JSON_HEADERS },
        body: JSON.stringify({
            items: cids.map((id) => ({ item_id: id })),
            member_type: "member",
            own_url: ownUrl,
        }),
    };
}
export function booksRestore(cids, ownUrl = "https://book.dmm.co.jp/basket/") {
    return {
        url: "https://book.dmm.co.jp/ajax/basket/add",
        method: "POST",
        headers: { ...JSON_HEADERS },
        body: JSON.stringify({
            items: cids.map((id) => ({ item_id: id })),
            member_type: "member",
            own_url: ownUrl,
        }),
    };
}
/** DLsite emits one request per cid; FANZA stores batch into one request. */
export function buildDeleteRequests(source, cids, ctx = {}) {
    switch (source) {
        case "dlsite":
            return cids.map(dlsiteDelete);
        case "fanza-doujin": {
            if (!ctx.csrfToken) {
                throw new Error("fanza-doujin requires csrf-token from cart page meta");
            }
            return [doujinDelete(cids, ctx.csrfToken)];
        }
        case "fanza-books":
            return [booksDelete(cids, ctx.ownUrl)];
    }
}
export function buildRestoreRequests(source, cids, ctx = {}) {
    switch (source) {
        case "dlsite":
            return cids.map(dlsiteRestore);
        case "fanza-doujin": {
            if (!ctx.csrfToken) {
                throw new Error("fanza-doujin requires csrf-token from cart page meta");
            }
            return cids.map((cid) => doujinRestore(cid, ctx.csrfToken));
        }
        case "fanza-books":
            return [booksRestore(cids, ctx.ownUrl)];
    }
}
//# sourceMappingURL=cart.js.map