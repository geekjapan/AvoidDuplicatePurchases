# Issue #47: 関連製品・セール比較の契約

Status: synthetic-fixture 実装済み（2026-08-09）。`POST /api/import/related` は
`contract: "synthetic_related_v1"` のみ。ストア raw payload / 拡張 fetch は
adapter 調査後の人間ゲート。詳細は
[issue-47-related-sales-acceptance.md](./issue-47-related-sales-acceptance.md)。

Issue: [#47 関連製品とセール情報を比較して安く買えるようにする](https://github.com/geekjapan/AvoidDuplicatePurchases/issues/47)

## このノートの結論

- 既存の `listing` は「ローカルで保有が確認できた商品」の行であり、未保有の関連商品を入れてはならない。
- #47 は `GET /api/related-products` という読み取り面と、ストアごとの raw payload を受ける関連商品 import 面を追加する。既存の `/api/listings` や `/api/lookup` の意味は変えない。
- 関連性は、根拠を返せる `maker` / `author` / `series` / `store_related` だけに限定する。タイトル類似度や推測した関連性は出さない。
- 価格は「取得できた事実」と取得時刻を持つ。取得できない価格・割引率・終了時刻は `null` とし、古い値は `stale` と明示する。
- #45 の価格・リンク・画像付きライブラリ契約を先に固定し、#47 はその `Money` と freshness の意味を再利用する。Amazon、ebookjapan、楽天Koboなど新しい source は、各 adapter の調査が完了するまで対象に含めない。

## 調査した既存契約

`CONTEXT.md` は Release、配布 bundle、対応環境の用語を定義する文書で、販売商品や価格のドメイン規則は定義していない。[CONTEXT.md](../../CONTEXT.md#L1-L44)

現在の正は次のとおり。

- `work` / `listing` / `match_key` のモデルで、`listing` の行の存在が所有を表す。`listing` は `(source, cid)` が一意で、取り込みは削除しない。[docs/spec.md](../spec.md#L43-L88)、[001_initial.sql](../../server/migrations/001_initial.sql#L5-L35)
- 公開 `ListingSchema` は title、maker、series、image、購入日時までで、価格・通貨・税込税別・価格取得時刻・商品リンクはまだ持たない。[shared/src/api.ts](../../shared/src/api.ts#L126-L160)
- 管理画面は `/api/listings` をページングして取得し、現在は `work_id, id` の順に表示するだけで、価格 sort はない。[admin/src/api.ts](../../admin/src/api.ts#L36-L74)、[server/src/routes/listings.ts](../../server/src/routes/listings.ts#L71-L117)
- 現在の照会は、同一 store の `(source, cid)` を所有として判定し、他 store は正規化 title + maker の完全一致だけを返す。[server/src/services/lookup.ts](../../server/src/services/lookup.ts#L32-L49)、[server/src/services/lookup.ts](../../server/src/services/lookup.ts#L94-L153)
- fetch は拡張、parse・保存・照合は server、`shared/` は adapter の parse と API 型を持つ、という分割である。[docs/spec.md](../spec.md#L24-L41)
- 現在の adapter の normalized listing は title、maker、series、image、購入日時、raw JSON が中心で、価格や関連 edge は公開型にない。[shared/adapters/dlsite/types.ts](../../shared/adapters/dlsite/types.ts#L12-L36)、[shared/adapters/fanza_doujin/types.ts](../../shared/adapters/fanza_doujin/types.ts#L10-L18)、[shared/adapters/fanza_books/types.ts](../../shared/adapters/fanza_books/types.ts#L8-L25)、[shared/adapters/fanza_video/types.ts](../../shared/adapters/fanza_video/types.ts#L1-L10)、[shared/adapters/fanza_dlsoft/types.ts](../../shared/adapters/fanza_dlsoft/types.ts#L1-L10)
- 実地調査で価格らしい値が確認できるのは現時点では cart / source payload の一部である。DLsite は `price`、`official_price`、`is_discount`、FANZA 同人は `price`、`fixed_price`、`basket_price`、`campaign_info` などを返すが、これは関連商品一覧の価格契約を確定したものではない。[prototype/dlsite/README.md](../../prototype/dlsite/README.md#L20-L26)、[prototype/fanza/README.md](../../prototype/fanza/README.md#L103-L133)
- 商品 URL は source ごとに必要な証拠が違う。Books は `series_id`、Video は evidence-backed な floor がなければ URL を作らず `null` にする。[shared/adapters/dlsite/urls.ts](../../shared/adapters/dlsite/urls.ts#L37-L50)、[shared/adapters/dlsite/urls.ts](../../shared/adapters/dlsite/urls.ts#L57-L106)
- 所有履歴の raw evidence は保持し、後続の parser 修正で追随する前提である。[server/src/import/fanza/common.ts](../../server/src/import/fanza/common.ts#L273-L327)、[docs/spec.md](../spec.md#L192-L197)

## 用語と不変条件

### Product identity

外部参照は既存の `ProductIdentity = { source, cid }` を使う。`workId` や `listing.id` は返さない。`work.id` は rematch で不安定なので、外部参照に使わない。[shared/src/identity.ts](../../shared/src/identity.ts#L1-L27)、[docs/spec.md](../spec.md#L85-L88)

### Owned listing

`listing` に `(source, cid)` があることが、ローカルで確認できた所有の事実である。未保有の関連商品を `listing` に仮登録してはならない。これは既存の「listing の行の存在 = 所有」というモデルを壊さないためである。[docs/spec.md](../spec.md#L43-L73)

### Market offer

`market_offer` は、ある store の商品ページまたは sale payload から得た一時的な商品・価格 snapshot であり、所有を表さない。`(source, cid)` ごとに最新の成功 snapshot を一つだけ保持する。価格履歴、クーポンの組み合わせ、通貨換算はこの Issue の対象外とする。

### Relation evidence

関連商品が anchor に関係することを示す、source または既存正規化ロジックに基づく構造化根拠。根拠のない「おすすめ」や fuzzy title similarity は relation evidence ではない。

## 関連性の契約

### Anchor と候補

anchor は、ユーザーが開いている保有 `ProductIdentity` である。server は anchor を既存 `listing` から解決し、見つからなければ `404 not_found` を返す。

候補は必ず次を持つ。

```ts
product: {
  source: Source;
  cid: string;
  title: string;
  maker: string | null;
  seriesId: string | null;
  imageUrl: string | null;
  productUrl: string | null;
}
```

`source` と `cid` のない title-only 候補は保存・表示しない。既存の `ListingSchema` の metadata 命名を使うが、unowned candidate に `id`、`workId`、`purchasedAt` を追加して `listing` のように見せない。[shared/src/api.ts](../../shared/src/api.ts#L135-L160)

### 許可する evidence

候補の `relation.evidence` は一件以上の次の union とする。

```ts
{
  kind: "maker" | "author" | "series" | "store_related";
  origin: "derived" | "store";
  anchorValue: string | null;
  productValue: string | null;
}
```

- `maker` / `author`: anchor と候補の値を既存の正規化関数で比較し、完全一致した場合だけ。`origin` は `derived`。
- `series`: adapter が同じ series identity を明示した場合だけ。store-local な `series_id` を異なる store 間で同じものと推測しない。
- `store_related`: store の payload が anchor と候補の関係を明示した場合だけ。`origin` は `store`。store が表示する relation label がある場合は `productValue` に保存し、なければ `null` とする。
- `anchorValue` / `productValue` は UI で根拠を表示するための未正規化表示値。比較に使った normalized key は内部値で、公開 API に必須ではない。
- 一つの候補に複数根拠がある場合は全件返す。relation の数値 confidence は導入しない。

現在の自動 merge は title 完全一致、候補キューは maker 完全一致 + Dice 閾値という別の規則である。[docs/spec.md](../spec.md#L107-L116) したがって、それらを「関連」の根拠として流用しない。

## 所有済み商品の除外・表示

GET の query に `owned=exclude|mark` を置き、既定値は `exclude` とする。

返却 item には必ず次を含める。

```ts
ownership: {
  status: "owned" | "possible_duplicate" | "not_confirmed";
  matchedBy: "source_cid" | "title_maker" | null;
  ownedBy: ProductIdentity[];
}
```

- `owned`: 候補の `(source, cid)` が `listing` にある。`ownedBy` はその listing の work group に属する既知の `(source, cid)` を返す。
- `possible_duplicate`: 候補の title + maker が、既存 lookup と同じ正規化完全一致で別 store の listing に一致した。これは所有の断定ではないが、重複購入防止のため既定では除外する。[server/src/services/lookup.ts](../../server/src/services/lookup.ts#L104-L148)、[docs/spec.md](../spec.md#L124-L131)
- `not_confirmed`: local DB から ownership を確認できない。これは「外部 store に未所有」とは断定しない。同期されていない store の商品もここに入る。
- `owned=exclude` は `owned` と `possible_duplicate` を item 生成前に除外する。`owned=mark` は両方を返し、UI は状態と `ownedBy` を明示する。
- title だけ、maker だけ、fuzzy similarity だけでは `owned` に昇格しない。

## 価格・freshness

### Price shape

```ts
type Money = {
  amountMinor: number;       // integer >= 0; floating point の円額は使わない
  currency: string;          // ISO 4217 uppercase 3-letter code
  tax: "included" | "excluded" | "unknown";
};

price: {
  current: Money | null;
  regular: Money | null;
  discountPercent: number | null; // 0..100, 小数第2位まで
  saleEndsAt: string | null;      // source が明示した ISO8601 instant のみ
  observedAt: string | null;      // server が成功取得を受けた時刻
  freshness: "fresh" | "stale" | "unavailable";
}
```

- `current` は source がその時点で購入可能と報告した価格、`regular` は source が対応付けた通常価格。値がない場合は `null` で、片方からもう片方を複製しない。
- `discountPercent` は source の明示値を検証して採用するか、`current` と `regular` が同じ currency・tax で `regular.amountMinor > 0` の場合だけ server が `(regular-current)/regular*100` から算出する。それ以外は `null`。`0` を「不明」の代用にしない。
- `saleEndsAt` は source が明示した終了時刻だけを保存する。`observedAt`、TTL、表示中の sale label から推測しない。
- `observedAt` は price facts の成功取得時刻であり、購入日時ではない。既存の `purchasedAt` / `purchasedAtPrecision` と混ぜない。[docs/spec.md](../spec.md#L60-L70)、[shared/adapters/fanza_video/parse.ts](../../shared/adapters/fanza_video/parse.ts#L50-L68)
- 最初の契約では `fresh` を `observedAt` から 24 時間以内、`stale` をそれより古い last-known current price、`unavailable` を価格なし・parse 不能・source が unavailable と報告した状態とする。24 時間は固定の初期値で、store 別設定は追加しない。
- `freshness` は保証ではなく表示状態である。`stale` の値は observedAt と一緒に表示してよいが、fresh price より下位に並べる。unavailable は relation と metadata を残したまま price fields を `null` にする。
- 価格 payload の取得失敗では、直前の成功 snapshot を消さず、古い値と時刻を残す。成功した payload が「価格なし」と明示した場合は新しい `unavailable` snapshot に更新する。
- source の税区分が取れない場合は `tax: "unknown"`。税区分が違う Money 同士の割引計算・比較はしない。
- FX 換算はしない。異なる currency の `price_asc` は currency code の bucket を分け、bucket をまたぐ金額比較をしない。

## Product links

`productUrl` は検証済みの canonical product page の absolute `https` URL または `null` とする。title、maker、cid の文字列連結や store search URL は product link として認めない。

既存の `productUrlForSource` を再利用する。DLsite、同人、dlsoft は source の URL builder、Books は `seriesId`、Video は evidence-backed floor が必要で、不足時は `productUrl: null` とする。[shared/adapters/dlsite/urls.ts](../../shared/adapters/dlsite/urls.ts#L103-L126)

リンクを作れなくても候補自体は落とさない。UI はリンクなしとして表示し、価格や relation evidence を捨てない。URL の validation 失敗は warning にし、`productUrl` を推測値で埋めない。

## HTTP interface

### Read

```text
GET /api/related-products
  ?anchorSource=<Source>
  &anchorCid=<non-empty cid>
  &owned=exclude|mark                 # default exclude
  &sort=relevance|price_asc|discount_desc|sale_ends_asc|title_asc
  &currency=<ISO 4217 optional>
  &source=<Source optional>
  &limit=<1..500 optional>
  &offset=<>=0 optional>
```

Response:

```ts
{
  anchor: ProductIdentity;
  generatedAt: string;
  items: Array<{
    product: RelatedProduct;
    relation: { evidence: RelationEvidence[] };
    ownership: Ownership;
    price: PriceSnapshot;
  }>;
  total: number;
  warnings: Array<{ source: Source; code: "unsupported" | "stale" | "unavailable" }>;
}
```

`anchorSource` / `anchorCid` を required にするのは、外部から不安定な `workId` を渡さないためである。query validation、pagination 上限、`400 invalid_request`、`404 not_found` は既存 API と同じ扱いにする。[shared/src/api.ts](../../shared/src/api.ts#L50-L75)、[server/src/http.ts](../../server/src/http.ts#L123-L155)

### Related payload import

拡張が user session を使って取得し、server に raw payload を渡す既存の flow に合わせる。

```text
POST /api/import/:source/related
{
  "anchor": { "source": "...", "cid": "..." },
  "payload": <raw store response>,
  "complete": true | false
}
```

adapter は raw payload を検証し、少なくとも identity、metadata、relation evidence、price snapshot、canonical URL evidence のうち source が提供したものを normalized result にする。server は境界で validation し、失敗は `400 invalid_request` とする。既存の per-source import mount と同じく、共通 plugin/factory は作らず、source adapter 一つずつで実装する。[server/src/route-mounts.ts](../../server/src/route-mounts.ts#L1-L27)、[docs/spec.md](../spec.md#L90-L105)

`complete=false` の page は既存 edge を削除しない。adapter が全 page を取得して `complete=true` を送ったときだけ、対象 anchor/source の edge set を置き換える。通信失敗や parse 失敗で、前回の relation・price snapshot を削除しない。

## Persistence boundary

実装時の最小追加は次の二つの table とする。既存 `listing` の意味を変えないために必要な追加であり、price history や一般的な catalog table は作らない。

```sql
related_edge(
  anchor_source, anchor_cid,
  product_source, product_cid,
  relation_kind,             -- maker | author | series | store_related
  evidence_json NOT NULL,
  observed_at NOT NULL,
  PRIMARY KEY(anchor_source, anchor_cid, product_source, product_cid, relation_kind)
)

market_offer(
  source, cid PRIMARY KEY,
  title NOT NULL, maker_name, series_id, image_url, product_url,
  availability,              -- available | unavailable | unknown
  current_amount_minor, regular_amount_minor,
  currency, tax_status,
  discount_percent, sale_ends_at, price_observed_at,
  raw_json NOT NULL, imported_at NOT NULL
)
```

`related_edge` は store-provided relation を保持し、同じ候補に複数 kind の根拠を持たせる。maker/author/series の derived edge も同じ構造に正規化しておくと、GET の ranking と evidence 表示が一か所で済む。`market_offer` は未保有商品を保持するが、決して `listing` には insert しない。raw JSON は既存 import と同じく parser 修正・再調査の証拠として残す。

## Ranking / sorting

数値の「おすすめ confidence」は持たず、固定 tuple で並べる。

1. relation priority: `store_related` (3) > `series` (2) > `maker` / `author` (1)。同一候補の最大 priority を使う。
2. price state: `fresh` > `stale` > `unavailable`。
3. `sort=price_asc`: 同じ currency bucket 内の `current.amountMinor` 昇順。
4. `sort=discount_desc`: 比較可能な `discountPercent` 降順。
5. `sort=sale_ends_asc`: source が明示した未来の `saleEndsAt` 昇順。過去の時刻や null は active sale の先頭に置かない。
6. `sort=title_asc`: title 昇順。

`sort=relevance` は 1 → 2 → current price 昇順とする。price / discount / ending sort でも、同値なら relation priority、最後は `(source, cid)` の stable order とする。server と admin が別々に ranking を実装せず、GET response の順序を正とする。現在の `/api/listings` が固定順であることからも、sort を公開 query 契約にするのが最小である。[server/src/routes/listings.ts](../../server/src/routes/listings.ts#L91-L117)

## 不可用・古いデータ

| 状態 | 表示 | ranking | 保存動作 |
|---|---|---|---|
| source 未対応 | relation は返さず warning | 対象外 | row を作らない |
| relation は取得済み、price なし | candidate は表示、price は `unavailable` / null | 最後 | edge と metadata は保存 |
| 通信・parse 失敗、過去 snapshot あり | last-known price + `stale` + `observedAt` | fresh より後 | 過去 snapshot を保持 |
| 成功 response が価格なしと明示 | price fields null、`unavailable` | 最後 | 新しい unavailable snapshot に更新 |
| `saleEndsAt` が過去 | 時刻はそのまま表示可、推測で延長しない | active sale の先頭にしない | source evidence として保持 |
| product URL evidence なし | candidate は表示、link は null | link で落とさない | raw evidence を保持 |

server が「取れなかった」ことを「売っていない」「割引なし」「セール終了」と読み替えない。画面には少なくとも `observedAt` と `freshness` を表示する。これは Issue #47 の「古い価格は取得時刻を示し、終了時刻や現在価格を推測しない」という要求と、既存の「取得不可を所有済みと推測しない」方針を同じ方向で適用するためである。[docs/spec.md](../spec.md#L102-L105)、[docs/spec.md](../spec.md#L192-L197)

## #45 と store adapter への依存

### #45 の完了が必要な理由

Issue #45 は保有製品の画像、商品リンク、購入価格、現在価格、通貨、税込税別、価格取得時刻を一つのライブラリ画面で扱う issue である。[Issue #45](https://github.com/geekjapan/AvoidDuplicatePurchases/issues/45)

#47 は次を #45 から再利用し、別名の parallel contract を作らない。

1. `ProductIdentity` / source-cid を anchor として選択する方法。
2. `Money` の minor unit、currency、tax semantics。
3. `observedAt` と stale 判定の意味。
4. 保有 listing の product URL、image、current price の公開 shape。

#45 がこれらの名前や freshness policy を変えた場合、このノートの Price shape を先に更新する。#45 が未完了の間は #47 の admin UI や shared schema を実装しない。

### adapter research の完了条件

source ごとに、実装前に次を一次 payload と実測で確定する。

- 関連商品の取得経路と relation kind、pagination、全件取得完了の検知。
- current / regular price の意味、currency、税込税別、クーポン・会員価格の扱い。
- source が明示する sale end、unavailable / discontinued 状態、取得時刻。
- canonical product URL と URL に必要な追加 identity（Books の `series_id`、Video の floor など）。
- 拡張の Cookie fetch、利用条件、rate limit、エラー時の再取得方法。

既存の adapter は history import を実装しているが、FANZA Video は viewing-rights timestamp を購入日へ写さず raw evidence にだけ残している。[shared/adapters/fanza_video/parse.ts](../../shared/adapters/fanza_video/parse.ts#L42-L68) この保守的な扱いを価格・sale end にも適用する。

対象 source はまず既存の `SOURCES` のうち調査が land したものだけとする。第一波の intervention source は DLsite、FANZA 同人、FANZA ブックスで、動画・PCゲームは履歴取り込みのみという既存 scope がある。[shared/src/identity.ts](../../shared/src/identity.ts#L1-L15)、[docs/spec.md](../spec.md#L13-L22) #43 Amazon、#44 ebookjapan、#46 楽天Koboは、source enum・adapter・取得条件が別途確定するまで #47 の対象外とする。

## 未解決の user decision

実装開始前に、次をユーザー／maintainer が確定する必要がある。推奨値はこのノートの最小案であり、確定値ではない。

1. **対象 store**: 推奨は、最初は adapter research が完了した DLsite / FANZA 同人 / FANZA ブックスだけ。既存 5 source 全てを同時に比較するか、動画・PCゲームも admin-only で含めるか。
2. **価格の基準**: 推奨は `amountMinor` + ISO currency + `included|excluded|unknown`。税区分不明を JPY 税込へ正規化しない。source の「通常価格」がない場合に `regular=null` とするか。
3. **freshness TTL**: 推奨は固定 24 時間。sale の性質上、6 時間など短い TTL にするか、store 別 TTL を許すか。
4. **ownership の UX**: 推奨は既定で `owned` と `possible_duplicate` を除外し、`owned=mark` で明示する。possible duplicate を候補として残す表示を望むか。
5. **取得トリガー**: 推奨は拡張がユーザー操作で raw payload を取得し、server は last-known cache を返す方式。管理画面を開くたび自動 fetch、定期 fetch、手動 refresh のどれを採用するか。
6. **#45 との共通型**: #45 の `Money` / freshness / product URL の最終名をこの案に合わせるか、#47 側がそれを採用するか。二重定義はしない。

## 実装開始条件

- #45 が上記の shared/public contract を land している。
- 対象 source ごとに adapter research が完了し、価格・relation・canonical link を推測なしで normalized result にできる。
- `shared/src/api.ts` にこの note の Zod schema、`server` に dedicated route と migration、`admin` に response を使う一画面を追加する。既存の listing/work assignment/lookup の semantics は変更しない。
- adapter が提供しない field は `null`、取得失敗は last-known + `stale`、未対応 source は warning とし、アプリケーションコードの実装はこの条件が揃ってから始める。
