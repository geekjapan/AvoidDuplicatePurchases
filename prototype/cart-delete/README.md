# カートからのワンクリック削除 — 書き込み側の実現方法(#9)

読み取り側は #4(DLsite)/ #5(FANZA)で確定済み。本チケットは**削除の書き込み側だけ**。

**破壊的操作は一切実行していない。** 3サイトとも削除ボタンのイベントハンドラ(公開 JS / インライン script)を静的に読み、削除がどの HTTP 呼び出しに落ちるかを特定した。ユーザーのカートは触っていない。エンドポイントの実叩き(実際に商品が消えるか)は、下記「実カートでの最終確認」の手順でユーザー合意を取ってから行う。

## 結論

**3サイトとも削除 API が存在し、DOM ボタンのクリック合成は不要。** ただし方式・認証・ペイロードは店舗ごとに割れる。拡張側は「(source, cid) → 削除」の共通インタフェースの裏に3実装をぶら下げる。

| サイト | メソッド | エンドポイント | ペイロード | CSRF |
|---|---|---|---|---|
| DLsite | GET | `/maniax/cart/ajax/=/mode/nothanks/product_id/<workno>` | URL パスに workno | 無し(Cookie のみ) |
| FANZA 同人 | DELETE | `/dc/doujin/api/baskets/` | JSON `{product_ids:[cid], _token}` | `<meta csrf-token>` を body に付与 |
| FANZA ブックス | POST | `/ajax/basket/delete` | JSON `{items:[{item_id:cid}], member_type, own_url}` | 無し(Cookie のみ) |

すべてブラウザセッション Cookie 前提。拡張の service worker から `credentials:"include"` で叩ける(同人・ブックスの CORS は #5 の host_permissions で対応済み)。

## (1) DLsite — `mode/nothanks` の GET

カートページ(`www.dlsite.com/maniax/cart`)のインライン script。削除リンク `a.link_delete` の `href` を GET で叩くだけ:

```js
// 実 DOM の click ハンドラ(要約)
$cart.on('click', 'a.link_delete, a.link_move', function() {
  $.ajax({ method: "get", url: $(this).attr('href'), dataType: "XML" })
});
```

- `href` の実体は `https://www.dlsite.com/maniax/cart/ajax/=/mode/nothanks/product_id/<workno>`
  (レコメンド枠の「興味なし」も同じ `mode/nothanks` を使う。カート削除もこれ)。
- `a.link_move`(= お気に入りへ移動)は別 URL だが同じ GET パターン。**削除だけなら `mode/nothanks` を組み立てれば DOM 依存ゼロ**。
- 復元(元に戻す)は `mode/cart/obj_nocheck/1/product_id/<workno>` の GET(`_btn_cart` / `__undo` ハンドラ)。**誤削除の undo が API で可能**。
- CSRF トークンは無い。workno は #4 の `li.cart_list_item[data-workno]` から取れる。

→ 拡張実装: `GET cart/ajax/=/mode/nothanks/product_id/<workno>` を fetch。DOM ボタンを探す必要なし。

## (2) FANZA 同人 — REST DELETE

React SPA。`doujin-assets.dmm.co.jp/.../basket_pc.js` の fetch ラッパー:

```js
// baseURL = "/dc/doujin"、既定ヘッダに X-Requested-With
handleDeleteBaskets: async (product_ids) =>
  fetch("/dc/doujin/api/baskets/", {
    method: "DELETE",
    headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
    credentials: "include",
    body: JSON.stringify({ product_ids: [cid], _token }),  // _token は下記で付与
  })
```

- **CSRF**: ページ `<meta name="csrf-token">` の値を body の `_token` に入れる(ラッパーの `b()` が全リクエストに自動付与)。拡張も同人カートページの meta から読んで付ける。
- `product_ids` は配列。**複数一括削除が1リクエストで可能**。
- 復元: `POST /dc/doujin/api/baskets/`(`{product_id}`)。ブックマーク経由の戻しは `PATCH /api/baskets/move-from-bookmark/`。
- cid は #5 の `GET /dc/doujin/api/baskets/` の `data[].content_id`。

## (3) FANZA ブックス — jQuery POST

`book.dmm.co.jp/assets/js/dc/basket/basket-ui.pc.js` の `clickDeleteBasket`:

```js
connectUrl.deleteBasket = "/ajax/basket/delete"
// ペイロード(formatJsonForDeleteBasket)
{ items: [{ item_id: <cid> }], member_type: "member", own_url: location.href }
// POST /ajax/basket/delete, dataType json, Cookie セッション
```

- **CSRF トークンは使わない**(meta 無し・body にも無し)。`member_type` は `#fn-memberType` の値(ログイン時 `member`)。
- `item_id` は #5 の `GET /ajax/bff/basket_product_ids/` の `product_ids[]`(= cid)。
- 復元: `restoreBasket = "/ajax/basket/add"`(ブックマークからの戻しは `move_to_basket`)。
- **注意**: `own_url` に現在 URL を要求する。拡張の service worker から叩く場合はカートページ URL を明示的に入れる。

## (4) 拡張インタフェースの揃え方

店舗差(メソッド・トークン・配列/単体)を吸収する薄い抽象1枚:

```ts
interface CartDeleter {
  // #4/#5 で確定した読み取り結果の cid をそのまま渡す
  remove(cids: string[]): Promise<{ ok: string[]; failed: string[] }>;
  restore(cids: string[]): Promise<void>;  // 誤削除 undo(3サイトとも API あり)
}
```

- DLsite = cid ごとに GET ループ(バルク API 無し)。同人 = `product_ids` 配列で1発。ブックス = `items` 配列で1発。
- **`restore` を必須にする**: 3サイトとも復元 API が存在するので、確認ダイアログではなく「削除 → トースト『元に戻す』」の楽観的 UX が組める(#1「自動削除はしない」は満たしたまま、削除自体は1クリック)。
- CSRF が要るのは同人のみ。抽象の外(各アダプタ内)で meta 読み取りを閉じる。

## (5) 誤削除の安全策(#1「自動削除はしない」の具体)

- **削除はユーザーの明示クリックのみ**(バッジは警告表示まで。勝手に消さない)。
- 3サイトとも `restore` API があるので、**削除確認ダイアログは不要**。「消しました・元に戻す」の undo で誤操作をカバー(ダイアログより摩擦が低く安全性は同等)。
- ブックスの `own_url` / 同人の `_token` のように**ページ文脈に依存する値がある**ため、削除はカートページを開いている時に限定するのが堅い(拡張のカート介入は元々カートページ上で動く前提)。

## 実カートでの最終確認(未実施・要ユーザー合意)

静的解析で方式は確定したが、**実際に叩いて商品が消える/戻るかは未検証**(破壊的なので)。拡張実装前に、ユーザーのカートに安価な1商品を入れた状態で以下を1件ずつ確認する手順を提示してから実行:

1. DLsite: `mode/nothanks` GET → カートから消えるか / `mode/cart` GET で戻るか。
2. 同人: DELETE `api/baskets/` → 消えるか / POST で戻るか(`_token` 必須の確認)。
3. ブックス: POST `/ajax/basket/delete` → 消えるか / `own_url` 省略時の挙動。

## 成果物

- `endpoints.ts` — 3サイトの削除/復元リクエストを組み立てる純関数 + セルフチェック。`npx tsx endpoints.ts`。
- 参照した公開 JS/HTML: DLsite カートページのインライン script、`basket_pc.js`(同人)、`basket-ui.pc.js`(ブックス)。いずれも未ログインで取得可能。
