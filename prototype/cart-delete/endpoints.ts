// カート削除/復元リクエスト組み立て(Issue #9)— 静的解析で確定した3サイトの書き込み側。
// `npx tsx endpoints.ts` でセルフチェック(URL/ペイロード生成のみ。実叩きは破壊的なので含めない)。
//
// 認証は3サイトともブラウザセッション Cookie(credentials:"include")。CORS は #5 の
// host_permissions 前提で拡張の service worker から叩く。CSRF が要るのは FANZA 同人のみ。

import { strict as assert } from "node:assert";

export type Source = "dlsite" | "fanza-doujin" | "fanza-books";

/** fetch にそのまま渡せる形。DLsite は body なしの GET。 */
export interface DeleteRequest {
  url: string;
  method: "GET" | "POST" | "DELETE";
  headers: Record<string, string>;
  body?: string;
}

const JSON_HEADERS = { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" };

// ---- DLsite: GET mode/nothanks（バルク無し・1件ずつ / CSRF 無し）----
export function dlsiteDelete(workno: string): DeleteRequest {
  return {
    url: `https://www.dlsite.com/maniax/cart/ajax/=/mode/nothanks/product_id/${workno}`,
    method: "GET",
    headers: {},
  };
}
export function dlsiteRestore(workno: string): DeleteRequest {
  return {
    url: `https://www.dlsite.com/maniax/cart/ajax/=/mode/cart/obj_nocheck/1/product_id/${workno}`,
    method: "GET",
    headers: {},
  };
}

// ---- FANZA 同人: DELETE /dc/doujin/api/baskets/（配列で一括 / _token 必須）----
// csrfToken はカートページの <meta name="csrf-token"> content。
export function doujinDelete(cids: string[], csrfToken: string): DeleteRequest {
  return {
    url: "https://www.dmm.co.jp/dc/doujin/api/baskets/",
    method: "DELETE",
    headers: { ...JSON_HEADERS },
    body: JSON.stringify({ product_ids: cids, _token: csrfToken }),
  };
}
export function doujinRestore(cid: string, csrfToken: string): DeleteRequest {
  return {
    url: "https://www.dmm.co.jp/dc/doujin/api/baskets/",
    method: "POST",
    headers: { ...JSON_HEADERS },
    body: JSON.stringify({ product_id: cid, _token: csrfToken }),
  };
}

// ---- FANZA ブックス: POST /ajax/basket/delete（配列で一括 / own_url 必須 / CSRF 無し）----
export function booksDelete(cids: string[], ownUrl = "https://book.dmm.co.jp/basket/"): DeleteRequest {
  return {
    url: "https://book.dmm.co.jp/ajax/basket/delete",
    method: "POST",
    headers: { ...JSON_HEADERS },
    body: JSON.stringify({ items: cids.map((id) => ({ item_id: id })), member_type: "member", own_url: ownUrl }),
  };
}
export function booksRestore(cids: string[], ownUrl = "https://book.dmm.co.jp/basket/"): DeleteRequest {
  return {
    url: "https://book.dmm.co.jp/ajax/basket/add",
    method: "POST",
    headers: { ...JSON_HEADERS },
    body: JSON.stringify({ items: cids.map((id) => ({ item_id: id })), member_type: "member", own_url: ownUrl }),
  };
}

// ---- 拡張が使う共通インタフェース ----
// DLsite だけバルク API が無いので cid ごとに1リクエスト、他は1リクエストに畳む。
export function buildDeleteRequests(
  source: Source,
  cids: string[],
  ctx: { csrfToken?: string; ownUrl?: string } = {},
): DeleteRequest[] {
  switch (source) {
    case "dlsite":
      return cids.map(dlsiteDelete);
    case "fanza-doujin":
      assert(ctx.csrfToken, "fanza-doujin は csrf-token が必須(カートページ meta から取得)");
      return [doujinDelete(cids, ctx.csrfToken)];
    case "fanza-books":
      return [booksDelete(cids, ctx.ownUrl)];
  }
}

// ---- セルフチェック ----
if (import.meta.url === `file://${process.argv[1]}`) {
  // DLsite: DOM 依存せず nothanks を組み立てられる / 復元は別 mode
  assert.equal(dlsiteDelete("RJ000000").method, "GET");
  assert.match(dlsiteDelete("RJ000000").url, /mode\/nothanks\/product_id\/RJ000000$/);
  assert.match(dlsiteRestore("RJ000000").url, /mode\/cart\/.*product_id\/RJ000000$/);

  // 同人: DELETE + 配列 + _token を body に含む
  const d = doujinDelete(["d_100001", "d_100002"], "TOKEN");
  assert.equal(d.method, "DELETE");
  assert.deepEqual(JSON.parse(d.body!), { product_ids: ["d_100001", "d_100002"], _token: "TOKEN" });

  // ブックス: POST + items[].item_id + own_url、CSRF 無し
  const b = booksDelete(["b100xxxxx00001"]);
  assert.equal(b.method, "POST");
  const bp = JSON.parse(b.body!);
  assert.deepEqual(bp.items, [{ item_id: "b100xxxxx00001" }]);
  assert.equal(bp.member_type, "member");
  assert.ok(bp.own_url, "own_url は省略不可");
  assert.ok(!("_token" in bp), "ブックスは CSRF トークンを送らない");

  // 共通ビルダ: DLsite は cid 数だけリクエスト、他は1本に畳む
  assert.equal(buildDeleteRequests("dlsite", ["RJ1", "RJ2", "RJ3"]).length, 3);
  assert.equal(buildDeleteRequests("fanza-doujin", ["d_1", "d_2"], { csrfToken: "T" }).length, 1);
  assert.equal(buildDeleteRequests("fanza-books", ["b1", "b2"]).length, 1);

  // 同人で token を忘れたら止める(誤ってトークン無し DELETE を投げない)
  assert.throws(() => buildDeleteRequests("fanza-doujin", ["d_1"]), /csrf/);

  console.log("ok: cart-delete endpoints self-check passed");
}
