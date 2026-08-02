# DLsite 実地調査(Issue #4)— 確定版

調査日: 2026-08-03。未ログイン検証(curl)+ ログイン済みブラウザでの実測(computer-use 経由で DevTools コンソールを駆動)による確定結果。

## (1) 購入履歴 — API は `v3/content/sales` が本命

- **`GET https://play.dlsite.com/api/purchases?page=1` は廃止済み**(ログイン済みでも 404 `{"message":"Not Found"}`)。調査資料(kurorinchan/dlsite-purchased)の情報は古い。`/api/v3/purchases` も 404。
- DLsite Play SPA がライブラリ表示に実際に呼ぶ API(performance リソース実測):
  - `GET /api/v3/content/sales?last=0` → **200、購入全件の配列**(実測 591 件)。要素は `{workno, sales_date}`(例: `{"workno":"VJ013196","sales_date":"2022-06-11T14:20:07.000000Z"}`)。**ページングなし・全件一括**、`last=` は増分同期用カーソル(タイムスタンプ)。未ログインは 401。
  - `GET /api/v3/content/count?last=0` → `{user: 591, production: 0, page_limit: 50, concurrency: 500}`
  - `POST /api/v3/content/works` → 作品メタデータ本体。GET は 405、`{worknos:[...]}` ボディは 400。Service Worker 経由の同期らしくボディ形式は未特定 — **公開 `product.json` で代替できるため深追いしない**。
- 認証はブラウザセッション Cookie(`credentials:'include'` で成功)。拡張は `host_permissions` に play.dlsite.com を入れれば Cookie が自動送信されるので、トークン抽出等は不要。
- **バックフィル戦略**: `sales` で workno+購入日を全件取得 → 各 workno のメタデータは公開 `product.json` で補完(未ログインで可)。差分は `last=` カーソル。HTML スクレイピング(`mypage/userbuy`)は不要になったため未検証のまま破棄。

## (2) 商品を一意に特定する ID = workno

- URL 正規形: `https://www.dlsite.com/maniax/work/=/product_id/RJ######.html`(`og:url` メタタグ)。正規表現 `[BRV][JE]\d{6,8}`。
- `GET https://www.dlsite.com/maniax/api/=/product.json?workno=RJ…&locale=ja-JP` — **未ログイン 200、255 フィールド**。正規化に効く: `workno`, `work_name`, `work_name_kana`, `maker_name`, `maker_id`, `circle_id`, `series_id/series_name`, `title_id/title_name`, `language_editions`, `translation_info`。収録関係の fog に直結: `work_pack_children`, `work_pack_parent`, `is_pack_child`, `is_pack_parent`, `title_work_count`, `editions`。

## (3) カート内商品の識別 — `data-workno`(実 DOM で確定)

- カートページ: `https://www.dlsite.com/maniax/cart`(未ログインでも 200。`cart/=/` は 404)。
- 商品入りカートの実 DOM: アイテムは `li.cart_list_item._cart_items`、dataset に
  `workno`, `productId`, `makerId`, `price`, `official_price`, `is_discount`, `ageCategory`, `siteId`, `workType`, `titleWorkCount`, `translation_info(JSON)` など。
- **注意**: `.cart_list [data-workno]` はページ内に同一 workno が2回現れる(レイアウト複製)— workno で dedupe すること(`parseCartDom` 実装済み)。
- 空カートは `.empty_box`。カート追加リンクは `cart/=/product_id/RJ*.html` だが、コンソールからの単純遷移では追加されなかった(トークン等の前提あり? 拡張はカートを読むだけなので追わない)。

## 成果物

- `fetch-stub.ts` — sales バックフィル / product.json / カート DOM パースの最小スタブ。`npx tsx fetch-stub.ts` で未ログイン範囲のセルフチェック。
