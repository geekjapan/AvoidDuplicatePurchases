# Issue #42 ロードマップ最終統合監査報告

## 監査の固定点

- 監査日: 2026-08-09 (Asia/Tokyo、`2026-08-09T01:06:27+09:00`)
- **歴史的監査固定点 (historical audit point)**: `9a72071d28837172fcf947acb0913e5094e8f8ad`
  - 本報告の実装記述・Issue 照合・検証メモは、この SHA 時点の tree に対する監査結果である。
  - 後続の visible-DOM repair / R5 修正 / final delivery SHA は、この固定点の証拠を改変せず、別コミットとして積む。
  - 共通 visibility helper（`dom-visibility.ts`）や price-observation の fail-closed 統一など、本固定点より後に入った修正は、この報告の「固定 SHA の実装」には含めない。
- 監査時点の WorkTree `HEAD`（当時）: `9a72071d28837172fcf947acb0913e5094e8f8ad`
- 旧監査報告の固定点: `80e2110f05fa838add991df2e167bfe792e47d4a`
- 比較上の実装親: `badbb941844e225d41858a4bb521f7d2b7a8db22`
- 対象 Issue: [#42](https://github.com/geekjapan/AvoidDuplicatePurchases/issues/42)、および本文で列挙された [#43](https://github.com/geekjapan/AvoidDuplicatePurchases/issues/43)、[#44](https://github.com/geekjapan/AvoidDuplicatePurchases/issues/44)、[#45](https://github.com/geekjapan/AvoidDuplicatePurchases/issues/45)、[#46](https://github.com/geekjapan/AvoidDuplicatePurchases/issues/46)、[#47](https://github.com/geekjapan/AvoidDuplicatePurchases/issues/47)
- この監査は、live GitHub Issue の読み取り、固定 SHA の source/docs/test 読み取り、synthetic/redacted evidence に限定した。Issue の close/comment/label、push、PR、merge、provider への実データ取得、Cookie/password/localStorage/private API の読み取り、実 cart/coupon/purchase 操作は行っていない。

## 結論

Issue #42 と #43〜#47 は、現時点で close 済みとは扱えない。live GitHub 上の 6 Issue はすべて `OPEN`、`enhancement` + `needs-info`、assignee なしであり、#42 本文の planned issues チェックも未完了のままである。

固定 SHA には、次の「実装された範囲」は存在する。

1. Amazon / ebookjapan / 楽天Koboについて、利用者がサインイン済みの公式ライブラリ画面を開いた状態から、可視 DOM だけを読み、明示的な状態とメタデータをローカル `library_observation` に取り込む reader/sync/import 経路。
2. 既存 5 source の管理画面向け safe display（画像、購入日、検証済み HTTPS 商品 URL、明示的な未取得表示）と、DLsite / DMM・FANZA の商品ページで可視の regular / sale / coupon 価格を別個の observation として保存する経路。
3. #47 の関連商品・セール比較は、契約文書だけで実装はない。

これらの可視 DOM 観測は、provider の公式 API、公式 export、第三者による自動取得許可、取得範囲の完全性、安定した ID、または「購入済み」という provider authority の証明ではない。したがって #43/#44/#46 のコードは「署名済み provider の正式な購入履歴同期」とは呼ばず、許可・仕様・人間判断が残る観測スライスとして記録する。

## live Issue 状態

`gh issue view <n> --comments --json ...` の読み取り結果は次のとおりである（更新時刻は GitHub の UTC 表示）。

| Issue | live state / labels / assignee | 最終更新 | 本文・最新コメントとの照合 |
|---|---|---|---|
| [#42](https://github.com/geekjapan/AvoidDuplicatePurchases/issues/42) | `OPEN` / `enhancement`, `needs-info` / なし | `2026-08-08T11:26:05Z` | 親ロードマップ。#43〜#47 の planned checklist は未チェック。最新コメントも docs の統合と #45 safe slice を認める一方、価格、追加 3 store、関連比較は未実装としている。 |
| [#43](https://github.com/geekjapan/AvoidDuplicatePurchases/issues/43) | `OPEN` / `enhancement`, `needs-info` / なし | `2026-08-08T11:26:17Z` | Amazon.co.jp Kindle の対象・状態・識別方針は調査済みだが、公式 API/export または自動取得を許す明示経路は未確認。 |
| [#44](https://github.com/geekjapan/AvoidDuplicatePurchases/issues/44) | `OPEN` / `enhancement`, `needs-info` / なし | `2026-08-08T11:26:17Z` | ebookjapan の購入履歴 UI と暫定 `publicationCd` は整理済みだが、公開 API、内部 URL の許諾、状態 schema、安定 ID の保証は未確認。 |
| [#45](https://github.com/geekjapan/AvoidDuplicatePurchases/issues/45) | `OPEN` / `enhancement`, `needs-info` / なし | `2026-08-08T11:26:32Z` | PR #51 相当の既存 5 source safe display は確認されているが、購入価格・現在価格・通貨・税区分・価格観測時刻・価格 sort/filter の Issue 全体 acceptance は未完了。 |
| [#46](https://github.com/geekjapan/AvoidDuplicatePurchases/issues/46) | `OPEN` / `enhancement`, `needs-info` / なし | `2026-08-08T11:26:17Z` | 楽天Kobo の日本向け対象と状態は整理済みだが、公式 API/export または自動取得の明示許可は未確認。 |
| [#47](https://github.com/geekjapan/AvoidDuplicatePurchases/issues/47) | `OPEN` / `enhancement`, `needs-info` / なし | `2026-08-08T11:26:17Z` | #45 の価格/freshness 契約と #43/#44/#46 の取得経路・許可が Blocked by。関連 API/import、edge、market offer、価格取得は未実装。 |

Issue 状態を変更する権限はこの worker の範囲外であり、#42 と子 Issue の close、comment、label 変更は coordinator/human lifecycle に残す。

## 固定 SHA の実装と docs の照合

### 1. #43/#44/#46: signed-in 可視 DOM の観測・import スライス

共有 foundation は [`shared/src/identity.ts`](../../shared/src/identity.ts#L1-L62) の `LIBRARY_SOURCES`、明示的な `LIBRARY_ITEM_STATES`、3 provider の start URL と URL/CID/canonical-link gate、[`shared/src/api.ts`](../../shared/src/api.ts#L238-L307) の strict な `LibraryImportItemSchema` / `LibraryImportRequestSchema` を追加している。import item に price field はなく、Amazon/ebookjapan/Kobo の price はこの protocol から出ない。

[`extension/src/content/library.ts`](../../extension/src/content/library.ts#L68-L104) は provider reader を dispatch し、安全な HTTPS・同一 host の next-page だけを通す。provider reader は次の可視証拠を使う。

| source | 可視 DOM から実装された範囲 | それでも正式な provider authority としない理由 |
|---|---|---|
| Amazon | [`amazon-library.ts`](../../extension/src/content/amazon-library.ts#L82-L97) が可視 `取得日:` を `purchased`、`レンタル日:` または返却/利用終了 action を `rental`、その他・欠落を `unknown` とする。ASIN、著者、画像、実在 HTTPS 商品リンク、可視 pager を保守的に読む。 | 研究文書は個人 Kindle library の公式 API/export 未確認、DOM 自動抽出の許可未確認と明記している（[`issue-43-amazon.md`](issue-43-amazon.md#L147-L168)）。現コードは marketplace/format と取得日文字列を共通 import item に保持せず、可視ラベルを provider の公式購入証明へ昇格できない。 |
| ebookjapan | [`ebookjapan-library.ts`](../../extension/src/content/ebookjapan-library.ts#L98-L167) はアクティブ `購入済み` タブだけを `purchased` とし、`無料読書履歴`、レンタル、試し読み、ギフト、予約、読み放題等を別状態に倒す。実在する可視 HTTPS `/books/<titleId>/<publicationCd>/` link の `publicationCd` を暫定 CID とする。 | 研究文書は公開購入履歴 API、内部 URL の利用許諾、安定 ID/state schema を未確認としている。内部 URL を呼ばずに可視 link を読む実装であっても、第三者 client による自動取得許可・履歴全件性の証拠にはならない（[`issue-44-ebookjapan.md`](issue-44-ebookjapan.md#L39-L75)）。 |
| Kobo | [`kobo-library.ts`](../../extension/src/content/kobo-library.ts#L94-L124) は選択された `追加した書籍` view を `purchased` とし、立ち読み、無料、Kobo Plus、予約、期間限定等を `sample`/`free`/`subscription`/`reservation`/`unknown` へ倒す。実在する title product link、著者、表示シリーズ、画像、可視 page link を読む。 | 研究文書は公式 API/export/自動取得許可を未確認とし、Kobo の Terms の page-scrape/data mining 制約も記録している。表示された view と product link は provider による購入履歴 export 仕様や安定 series ID を証明しない（[`issue-46-kobo.md`](issue-46-kobo.md#L6-L13)、[`issue-46-kobo.md`](issue-46-kobo.md#L120-L122)）。 |

background は [`extension/src/background/library-sync.ts`](../../extension/src/background/library-sync.ts#L134-L230) で popup 起点に start URL を開き、content-script の `login` / `page_not_ready` / `empty` / `ready` を待ち、可視 batch を最大 100 page の visited-loop で local server に送る。ログイン画面、異常な URL、cycle、readiness timeout は fail closed である。popup の入口は [`extension/src/popup/popup.ts`](../../extension/src/popup/popup.ts#L9-L74) にあり、password、Cookie、MFA、private API、購入・cart 操作を実装していない。

server 側は [`server/migrations/003_library_sync_sources.sql`](../../server/migrations/003_library_sync_sources.sql#L1-L68) の `library_observation` に `(source, cid, state, visible metadata, page_url, raw_json, observed_at)` を upsert し、[`server/src/import/library/index.ts`](../../server/src/import/library/index.ts#L24-L117) で state を保持する。`purchased` の明示 observation だけが既存 `listing` upsert と match-key 再計算に進み、free/rental/sample/subscription/gift/reservation/unknown は observation のままである。これは実装済み import behavior だが、visible label を official purchase authority とする判断ではない。

### 2. #45: safe display と visible price observation の境界

既存 5 source の safe display は、`GET /api/listings` が画像 provenance、購入日 precision、検証済み product URL、`purchasePrice: null`、`currentPrice: null` と独立した `priceObservation` を返し、admin が grouping/画像/日付/リンク/未取得を表示する形である（[`server/src/routes/listings.ts`](../../server/src/routes/listings.ts#L49-L147)、[`admin/src/pages/library.ts`](../../admin/src/pages/library.ts#L85-L100)、[`admin/src/pages/library.ts`](../../admin/src/pages/library.ts#L368-L392)）。`workId` は rematch で変わる内部 grouping key であり、外部の所有 identity ではない。

固定 SHA には、#45 の「購入価格」「現在価格」とは別の、可視の商品ページ価格 observation が実装されている。

| observation | 対象 source | 取得境界 | 非実行の境界 |
|---|---|---|---|
| regular | `dlsite`、`fanza_doujin`、`fanza_books` | DLsite は [`extractDlsitePriceTiers`](../../extension/src/content/price-observation.ts#L170-L218) の可視 label と近傍の一意な JPY 金額。DMM/FANZA は [`extractDmmFanzaPriceTiers`](../../extension/src/content/price-observation.ts#L59-L100) の可視 `.priceContainer` / `priceList__*` 内の「サークル設定価格」。 | 一意性がなければ `null`。推測、FX、税計算をしない。 |
| sale | `dlsite`、`fanza_doujin`、`fanza_books` | DLsite の「セール特価/セール価格/キャンペーン価格」、DMM/FANZA の「セール特価/セール価格/キャンペーン価格」を可視 DOM から読む。 | `currentPrice` や支払額へ昇格しない。 |
| coupon | `dlsite`、`fanza_doujin`、`fanza_books` | DLsite/DMM・FANZA の可視 coupon container に表示された適用後表示価格だけを読む。 | coupon click、coupon apply、cart checkout、purchase は行わない。coupon は支払った購入価格ではない。 |

各 tier は独立した JPY `Money`、不明な税区分は `unknown`、server receipt UTC を `observedAt` とする strict schema である（[`shared/src/api.ts`](../../shared/src/api.ts#L201-L235)）。product page で ownership lookup が成功した後だけ [`report-price.ts`](../../extension/src/content/report-price.ts#L10-L35) が可視値を送るが、server は既存 listing にだけ保存し、新しい listing を作らない（[`server/src/services/price-observation.ts`](../../server/src/services/price-observation.ts#L197-L289)）。`fanza_video` / `fanza_dlsoft` の価格観測はこの実装対象ではない。

従って #45 の判定は「safe display + visible regular/sale/coupon observation の部分実装」である。`purchasePrice`、`currentPrice`、通貨をまたぐ sort、価格 filter/sort、購入金額の一次 evidence、source ごとの price permission は未完了であり、Issue 本文の「価格付き」を満たしたとは記載しない。

### 3. #47: design-only

[`docs/research/issue-47-sales-contract.md`](issue-47-sales-contract.md#L1-L13) 自身が `Status: design-only` とし、#45 の price/freshness 契約と source adapter research の後に実装するよう定義している。固定 SHA には `GET /api/related-products`、related import route、`related_edge`、`market_offer`、関連比較 admin の実装はない。`listing` を未保有候補へ流用しない、relation evidence を maker/author/series/store_related に限定する、price unavailable/stale を推測しないという契約は、実装済み機能ではなく次の人間 gate である。

### 4. docs/spec.md との整合

[`docs/spec.md`](../spec.md#L1-L22) の v1 core は DLsite と FANZA 5 source、ローカル保持、provider session を使う既存 adapter import、first-wave intervention を定義している。固定 SHA の `amazon` / `ebookjapan` / `kobo` は、この core を provider authority まで拡張したものではなく、別 namespace の user-initiated visible-DOM observation protocol として追加されている。`docs/research/browser-dom-library-sync-contract.md` も price を持たない foundation と、3 provider の explicit state/visible DOM boundary を明記している（同文書 [`#L1-L18`](browser-dom-library-sync-contract.md#L1-L18)、[`#L38-L70`](browser-dom-library-sync-contract.md#L38-L70)）。

これは「コードが存在すること」と「provider がその自動取得を許可していること」を分けるための重要な差分である。research docs の provider authority blocker は、reader 実装メモが追加された後も解消されていない。

## Issue 別の最終判定と人間 gate

| Issue | 固定 SHA で確認できる実装/成果 | 残る blocker と human gate | close 判定 |
|---|---|---|---|
| #42 | 親ロードマップ、research/contract、safe display、3 provider の visible-DOM observation、#45 の visible price observation が存在する。 | 子 Issue の本文 acceptance、provider permission/API/export、#45 の full price contract、#47 の実装・review を live evidence で再確認する。safe slice/研究を正式な縮小 scope とするなら maintainer が Issue 本文と lifecycle を変更する必要がある。 | `OPEN` 維持。 |
| #43 | Amazon reader、popup/background sync、local observation/import、明示 `purchased` の listing mapping。 | Amazon.co.jp 個人 library の公式 API/export または自動取得を明示的に許可する書面/契約。併せて marketplace、Kindle format、取得日、返品/返金/KU/Prime Reading の entitlement と全件性を仕様化する。 | 部分実装。close 不可。 |
| #44 | ebookjapan bookshelf の可視 link reader、`publicationCd` 暫定 CID、購入/無料/試し読み等の明示 state、local import。 | 公開 API または provider 許諾、履歴保持範囲、安定 ID の保証、状態 schema、匿名化した実レスポンス。内部 URL の観測だけを official API と扱わない。 | 部分実装。close 不可。 |
| #45 | 既存 5 source の safe display と、DLsite/DMM・FANZA の可視 regular/sale/coupon observation。 | 購入価格と現在価格の意味/取得元/許可、currency/tax、observedAt/refresh/freshness、価格 sort/filter、#45 本文 acceptance のレビュー受入れ。coupon observation を購入価格と扱わない。 | 部分実装。close 不可。 |
| #46 | 楽天Kobo `追加した書籍` 可視 reader、購入/非購入 state、product link/metadata、local import。 | 楽天Kobo の公式 API/export/明示許可、region/account、entitlement、store-local ID と ISBN/eISBN の意味、series ID の安定性、全件性を仕様化する。 | 部分実装。close 不可。 |
| #47 | 契約文書・設計のみ。 | #45 の共通 Money/freshness/link 契約、source ごとの relation/price permission、related edge/market offer persistence、read/import route、admin UI、sorting、stale/unavailable tests を順に人間承認する。 | design-only。実装済みとしない。 |

## 検証・失敗の証跡

- `git rev-parse HEAD`: `9a72071d28837172fcf947acb0913e5094e8f8ad`。
- 固定 tree の source/docs/test を読み取り、live Issue #42〜#47 を `gh issue view --comments --json` で再確認した。
- synthetic fixture の対象 test file は、Amazon/ebookjapan/Kobo reader、generic library protocol、background pagination/login/empty/max-page、server library import、shared strict schema、DLsite/DMM-FANZA price tiers、owned lookup gate を直接カバーしている。実 provider account のデータや外部 store network は検証していない。
- 監査中に `npm test` を一度実行した。root runtime test 3 件と shared workspace 71 件は pass したが、extension/server では fixed source が `@adp/shared` の公開 `dist` entrypoint に期待する `librarySyncProvider` / `LIBRARY_ITEM_STATES` を runtime が解決できない失敗が出て、admin では `happy-dom` 不足も出た。これは stale `shared/dist` / dependency 解決を修正する別 repair worker と completion guard の固定 SHA 証跡に分離する verification limitation であり、この監査 worker は source/dist/依存を変更しない。
- 上記の test failure について、追加の全テスト診断・修復・再実行は行わない。full-suite green とは主張しない。
- 最終編集後に `git diff --check 9a72071d28837172fcf947acb0913e5094e8f8ad` を実行し、report の whitespace error がないことを確認する。最終 commit 後の `git status --porcelain --untracked-files=all` は clean にする。

## 権限境界と lifecycle handoff

この worker が行った write は本 Markdown report のみであり、source、generated `dist`、Issue、provider、browser session、remote branch は変更しない。次の行為は coordinator/human lifecycle に残す。

- #42〜#47 の close/comment/label/assignee 変更
- provider への permission/API/export 確認、契約解釈、safe slice の正式採用
- 価格の purchase/current semantics、freshness、currency/tax、related product scope の最終承認
- repair worker が行う `shared/dist` / 依存整合性の修復と、その fixed-SHA completion guard
- push、PR、merge、protected branch 操作

現時点の最終判断は、#42 と全 child Issue を open のまま保持し、観測スライス・safe display・価格 observation・design-only contract を、それぞれ provider authority / full acceptance / human scope gate と混同しないことである。
