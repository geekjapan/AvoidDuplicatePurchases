# FANZA 実地調査(Issue #5)— 確定版

調査日: 2026-08-03。未ログイン検証(curl)+ ログイン済み Chrome 実測(AppleScript 経由で `execute javascript`)による確定結果。
**本リポジトリは public のため、掲載した商品 ID・件数はすべて形式を保ったダミーに置換してある**(エンドポイント・フィールド名・挙動は実測のまま)。
DLsite 調査(#4)と同じ手順。対象店舗は #3 の決定に従い、履歴取り込み = 同人・ブックス・動画・GAMES、ページ介入 = 同人・ブックス。

## 結論(先に)

- **一本の経路で4店舗は賄えない。** 店舗ごとに別ドメイン・別方式(REST / BFF / GraphQL)の購入済み API があり、共通の購入履歴 API は存在しない。**店舗ごとにアダプタが要る。**
- 横断候補だった `payment.dmm.co.jp/history/` は**使えない**(後述)。
- カート介入(同人・ブックス)は**両方とも JSON API で取れる**。DLsite のような DOM スクレイピングは不要。

## (1) 購入履歴 — 店舗ごとに4本の経路

### 横断経路は不成立: `payment.dmm.co.jp/history/`

- `GET` は月セレクタのみ。`POST purchaseDate=YYYY-MM`(同 URL、form-urlencoded、セッション Cookie)で月別の明細 HTML が返る。
- **返るのは「日付 / 内容 / 合計金額 / お支払い方法 / 領収書」だけ**。内容欄は全件 `デジタルコンテンツ配信` で、商品名も cid も無い。リンクは領収書 ID のみ。
- → **商品を特定できないため購入履歴ソースにならない**。金額突合にしか使えない。

### 同人 — `GET /dc/doujin/api/mylibraries/`

```
https://www.dmm.co.jp/dc/doujin/api/mylibraries/?page=1&sort=purchasedate_desc&genre=all&limit=100
```

- 画面は `https://www.dmm.co.jp/dc/-/mylibrary/` だが、**API のパスは `/dc/doujin/api/`**。
- レスポンス: `{error_code, data: {items, total, hasNext}}`。**`items` は購入日文字列をキーにしたオブジェクト**(`{"2026年07月24日": [item, ...]}`)。購入日はこのキーからしか取れない(**日付のみ・時刻なし・和暦表記の文字列パース必須**)。
- **`limit` の上限は 100**(`limit=200` は 0 件で返る = 実質拒否)。`page` で送る。`page` 超過は 0 件。`total` / 100 のページ数で全件を舐められる。
- item フィールド: `contentId`, `productId`(両方同値 = `d_100001`), `title`, `imageSrc`, `genre`(ボイス/コミック/CG/…), `makerName`, `isStreaming`, `isUnavailable`, `isMylistRegistered`, `isCloudGame`, `isDownloadGame`。
- **メーカー ID は無い**(`makerName` のみ)。正規化はタイトル + メーカー名文字列が入力になる。

### ブックス — 2段構え(シリーズ → 巻)

```
1) https://book.dmm.co.jp/ajax/bff/library/?shop_name=all&page=1&order=added_desc&show_expired=0&format_webp=1
2) https://book.dmm.co.jp/ajax/bff/contents/?shop_name=adult&series_id=<sid>&page=1&per_page=100&order=asc&purchase_status=purchased&format_webp=1
```

- **本棚 API はシリーズ単位でしか返らない**(`series_books[]`)。`{pager: {page, per_page:20, total_count}}`。巻の一覧は取れず、`latest_purchased_volume_content_id` と `has_volumes` があるのみ。
- → **購入した個々の巻を得るには、シリーズごとに (2) を呼ぶ N+1 が必須。** `series_id` 無しの (2) は 400。実測でシリーズ数は十数件オーダーだったので N+1 で問題ない。
- (2) の要素 `volume_books[]`: `content_id`(= 商品 ID、例 `b100xxxxx01001`)、`title`, `volume_number`, `content_publish_date`, `sell.product_id`, `sell.fixed_price`、そして **`purchased.purchased_date`(ISO8601 `2023-12-30T12:00:00+09:00`)**。4店舗で唯一まともな購入日時が取れる。
- `shop_name` は `all` / `adult`。**`all` は一般向け(book.dmm.com)も含む**。floor 名は一般が `Gcomic`/`Gcomicf`/`Gphoto`、アダルトが `Abook`。実測でも両方が混在した。FANZAブックス だけ見るなら `adult` だが、重複購入回避の目的では `all` が正しい(一般の商品リンクは `book.dmm.com` 側になる点に注意)。
- ファセット: `/ajax/bff/library/facets/?shop_name=all&show_expired=0` で floor 別件数。

### 動画 — GraphQL `https://api.video.dmm.co.jp/graphql`

- SPA が実際に使うオペレーション: `Mylibrary` / `LoadMorePurchasedContent` / `MylibrarySearch` / `LoadMorePurchasedContentSearch`。
- クエリ本体は fetch/XHR パッチでは捕まえられない(モジュールが元の `fetch` 参照を保持しているため)。**JS バンドルを取得して正規表現で抽出**した。以下は実行して 200 を確認済み:

```graphql
query Probe($offset:Int!,$limit:Int!,$filter:PPVContentViewingRightsItemSummaryListFilterInput!,$sort:PPVContentViewingRightsItemSummaryListSort!){
  user{... on Member{ppvLibrary{contentViewingRightsSummaryList(filter:$filter,offset:$offset,limit:$limit,sort:$sort){
    pageInfo{hasNext totalCount}
    items{ id content{ id title floor contentType isDiscontinued } contentItem{ latestViewingRightsAcquiredAt } }
  }}}}}
```
variables: `{offset:0, limit:N, filter:{displayStatus:"VISIBLE"}, sort:"VIEWING_RIGHTS_ACQUIRED_AT_DESC"}`

- 認証はセッション Cookie(`credentials:'include'`)。`pageInfo.totalCount` + `hasNext`、`offset`/`limit` のオフセットページング。
- `id` = `content.id` = cid(例 `abcd00123`)。`floor`(AV 等)、`contentType`(TWO_DIMENSION 等)。
- **`latestViewingRightsAcquiredAt` は購入日時ではなく「視聴権の最終取得日時」**。実測で複数商品がまったく同一のタイムスタンプを持つ = 一括移行の痕跡。**購入日として信用してはいけない**。
- 公式フラグメント `purchasedContentSummaryFields` にも購入価格・購入日は無い。

### GAMES — 「GAMES」の指す先が2つある(要確認)

- **PCゲーム(美少女ゲーム DL 販売)= `dlsoft.dmm.co.jp`** — こちらが「買った作品」を持つ floor。
  `GET https://dlsoft.dmm.co.jp/ajax/v1/library?service=all&brand=&searchWord=&sort=order_desc&browserOnly=0&page=1`
  → `{error, body: {totalCount, library: [...]}}`。`page` でページング。
  要素: `contentId`/`productId`(= `brand_0001`)、`title`, `floor`(`Apcgame`)、`brand{name,listUrl}`, `authorArray[]`, `packageImageUrl`, **`deliveryBeginDate`**。
  **`deliveryBeginDate` は商品の配信開始日であって購入日ではない。購入日は取れない。**
- **FANZA GAMES(`games.dmm.co.jp` / `library.games.dmm.co.jp`)= 基本無料オンラインゲーム**。作品の買い切り購入という概念が無く、重複購入回避の対象外。
- → **#3 の「GAMES」は `dlsoft.dmm.co.jp`(PCゲーム)と解釈するのが妥当**。要ユーザー確認(下の「残る確認事項」)。

### 購入日まとめ(重要)

| 店舗 | 購入日 | 精度 |
|---|---|---|
| 同人 | items のオブジェクトキー | **日付のみ**・`2026年07月24日` 形式のパース必須 |
| ブックス | `purchased.purchased_date` | ISO8601 秒精度 ✅ |
| 動画 | `latestViewingRightsAcquiredAt` | **購入日ではない**(視聴権取得日、一括移行で潰れている) |
| PCゲーム | なし(`deliveryBeginDate` は配信開始日) | **取得不可** |

→ データモデル(#6)では **purchasedAt を nullable かつ精度付き**で持つ必要がある。

## (2) 商品を一意に特定する ID

FANZA は全店舗で **cid(コンテンツ ID)**。ただし**採番体系が店舗ごとに違い、横断で一意とは限らない**。

| 店舗 | ID 例 | 正規 URL | 取得元 |
|---|---|---|---|
| 同人 | `d_285449` | `https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_285449/` | `og:url` / `link[rel=canonical]`(両方一致・実測) |
| ブックス | `b100xxxxx01001` | `https://book.dmm.co.jp/product/<series_id>/<content_id>/` | API の `product_url` / `product_path` |
| 動画 | `abcd00123` | video.dmm.co.jp 配下(本調査では未確定) | GraphQL `content.id` |
| PCゲーム | `brand_0001` | dlsoft.dmm.co.jp 配下(本調査では未確定) | API の `contentId` |

- ブックスの URL は **series_id と content_id の2つを要求する**。content_id 単体から URL を組めないので、シリーズ ID も保存すること。
- 同人の商品詳細ページは**サーバレンダリング**で、JSON-LD `Product`(`name` / `image`)+ `og:url` が静的 HTML に載る。**未ログイン(年齢確認 Cookie `age_check_done=1` のみ)で 200**。
- **DLsite の `product.json` に相当する公開メタデータ API は FANZA には見つからなかった**。同人の正規化用メタは商品ページの JSON-LD + 購入履歴 API の `title`/`makerName` が入力になる。DLsite が持っていた `work_name_kana` / `maker_id` / `series_id` / `work_pack_*` に相当するものは無い。
  → **収録関係(単話⊂単行本)の検知は、FANZA 側ではブックスの `series_id` + `volume_number` だけが手がかり**。同人には手がかりが無い。#7(正規化)・#6(データモデル)への入力。
- 公式 Affiliate API(`api.dmm.com/affiliate/v3/ItemList`)は cid からメタ補完できる可能性があるが、API ID 取得が必要。本調査では未使用。

## (3) カート内商品の識別 — 両店舗とも JSON API(DOM 不要)

**カートは店舗ごとに完全に独立**(共通カートは無い):

- 同人 `https://www.dmm.co.jp/dc/doujin/-/basket/`
- ブックス `https://book.dmm.co.jp/basket/`
- 動画 `https://video.dmm.co.jp/basket/` / PCゲーム `https://dlsoft.dmm.co.jp/basket/`(介入対象外)

### 同人 — `GET /dc/doujin/api/baskets/`

```json
{"error_code":"0","error_message":[],"data":[
  {"content_id":"d_100003","product_id":"d_100003","title":"…","maker_name":"Tiramisu",
   "image_src":"…","price":10,"fixed_price":990,"basket_price":9,"genre":"CG","section":"mens",
   "campaign_info":{…},"coupon_info":{…}, …}
]}
```
→ `data[].content_id` で識別。DLsite と違い**重複要素は出ない**(dedupe 不要)。

### ブックス — `GET https://book.dmm.co.jp/ajax/bff/basket_product_ids/`

```json
{"product_ids":["b100yyyyy00001","b100yyyyy00002"]}
```
→ これだけ。件数だけなら `GET /ajax/basket/count/` → `{"result":true,"count":2}`。

### 拡張への含意

- カート介入は**カートページを開いた時に上記 API を1回叩けば済む**。DOM セレクタに依存しないので、FANZA のフロントエンド再ビルドに強い。
- ただしワンクリック削除(#1 で決定済み)は**削除 API が別途必要**。本調査では削除系は一切叩いていない(ユーザーのカートを壊さないため)。要追加調査。
- 商品ページ介入は `og:url` / `link[rel=canonical]` からの cid 抽出が本線。一覧ページの DOM フックは店舗・ページ種別ごとに違うため、UI チケットで個別に確認すること(同人トップは `a[href*="cid="]` で取れることのみ確認済み)。

## 認証

全店舗ともブラウザセッション Cookie のみ。トークン抽出は不要。拡張の `host_permissions` に必要:

```
https://www.dmm.co.jp/*      (同人: mylibrary API・basket API・商品ページ)
https://book.dmm.co.jp/*     (ブックス: library/contents/basket API)
https://api.video.dmm.co.jp/* + https://video.dmm.co.jp/*   (動画: GraphQL)
https://dlsoft.dmm.co.jp/*   (PCゲーム)
```

CORS 注意: `www.dmm.co.jp` から `book.dmm.co.jp` への fetch は**ブロックされる**(実測)。拡張の background/service worker から叩くこと。

## 残る確認事項

1. **#3 の「GAMES」= `dlsoft.dmm.co.jp`(PCゲーム)で確定してよいか。** `games.dmm.co.jp` は基本無料オンラインゲームで購入対象外。
2. カートからのワンクリック削除 API(同人・ブックス)。破壊的操作なので本調査では未検証。
3. 動画・PCゲームの商品ページ正規 URL 形式(履歴取り込みだけなら不要)。

## 成果物

- `fetch-stub.ts` — 4店舗の購入履歴パース + 2店舗のカートパース + cid 抽出の最小スタブ。実測レスポンスを固定値にしたセルフチェック付き。`npx tsx fetch-stub.ts`
