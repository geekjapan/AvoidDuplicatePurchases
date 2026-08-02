# DLsite 実地調査(Issue #4)

調査日: 2026-08-03。未ログインで検証できた事実と、ログイン後に検証が必要な残項目。

## 検証済み(未ログイン)

### (2) 商品を一意に特定する ID = workno

- URL 形式: `https://www.dlsite.com/maniax/work/=/product_id/RJ######.html`。`og:url` メタタグに正規 URL が入る(商品ページで 39 箇所出現、最頻の抽出点)。
- 商品メタデータ API: `GET https://www.dlsite.com/maniax/api/=/product.json?workno=RJ236867&locale=ja-JP` — **未ログインで 200**、配列で 1 件返る。**255 フィールド**。
  - 正規化に効くもの: `workno`, `product_id`(同値), `work_name`, `work_name_kana`, `maker_name`, `maker_id`, `circle_id`, `series_id`/`series_name`, `title_id`/`title_name`, `language_editions`, `translation_info`
  - 収録関係(fog「単話⊂単行本」)に直結: `work_pack_children`, `work_pack_parent`, `is_pack_child`, `is_pack_parent`, `title_work_count`, `editions`
- workno 正規表現 `[BRV][JE]\d{6,8}` は RJ 8桁で成立を確認。

### (3) カート内商品の識別方法

- カートページ URL は `https://www.dlsite.com/maniax/cart`(調査資料の `cart/=/` は 404)。未ログインでも 200。
- 空カート = `.empty_box`(「カートに作品は入っておりません」)。アイテムは `<ul class="cart_list">` に **クライアントサイドで動的挿入**。
- ページ内 JS がアイテム識別に `data-workno` 属性を参照(`$item.attr('data-workno')`)。関連属性: `data-pack-type`, `data-parentWorkno`。→ **カート内商品の識別は `data-workno` 属性ベースが本線**(要ログイン+商品入り実 DOM で確定)。
- カート追加はリンク `cart/=/product_id/RJ*.html`、AJAX `cart/ajax/=/mode/cart/...`(XML 応答、`product_id` 必須)。

### (1) 購入履歴 — 認証挙動のみ確認

- `GET https://play.dlsite.com/api/purchases?page=1` → 未ログインは 404 `{"message":"Not Found"}`(存在を隠す挙動。kurorinchan/dlsite-purchased は 2026-06 も本 API でメンテ継続中のため、セッション付きでは有効の見込み)
- `GET https://play.dlsite.com/api/v3/content/count?last=0` → 401(認証必須が明確)
- HTML 経路 `www.dlsite.com/maniax/mypage/userbuy/...` → 302 でログインページへ

## 要ログイン検証(残項目チェックリスト)

ログイン済みブラウザで `survey.js` を実行して以下を採取:

1. **play.dlsite.com の任意ページ**で実行 → `api/purchases?page=1` の実レスポンス(`total`/`limit`/`offset` の有無、`works[]` のフィールド一覧、workno の位置)
2. **カートに商品を1点以上入れて** `www.dlsite.com/maniax/cart` で実行 → `.cart_list` 内の実 DOM(`data-workno` の実在、タイトル/価格のセレクタ)
3. **`mypage/userbuy` ページ**で実行 → `.work_list_main` 系セレクタ(調査資料記載)の現行性
4. Cookie 方式の確認: play.dlsite.com への認証が `www.dlsite.com` の `PHPSESSID` 共有か、別トークンか(DevTools の Network タブで `api/purchases` のリクエストヘッダを確認)

採取結果はこの Issue #4 にコメントで貼り付け。

## 成果物

- `fetch-stub.ts` — 取得スタブ(purchases API ページング / product.json / カート DOM パース)。`npx tsx fetch-stub.ts` で未ログイン検証可能な範囲のセルフチェックが走る。
- `survey.js` — ログイン済みブラウザのコンソールに貼り付ける採取スクリプト(実行ページに応じて自動で対象を切替)。
