# DLsite / FANZA 既存スクレイパー・エクスポータ OSS 調査

Issue #2 の調査結果。DLsite・FANZA(DMM)の購入履歴/商品情報を扱う既存 OSS を洗い出し、使用ページ・エンドポイント・セレクタ・メンテ状況・ライセンスをまとめる。実地調査(DOM 検証)チケットの出発点として使う。

調査日: 2026-08-03。「最終更新」は各リポジトリの `pushed_at`(GitHub API)。

## DLsite

| リポジトリ | 種別 | 最終更新 | ライセンス | 概要 |
|---|---|---|---|---|
| [darekasan/dlsite-userbuy](https://github.com/darekasan/dlsite-userbuy) | ブラウザコンソール貼り付けスクリプト | 2021-12-10 | なし(LICENSE ファイルなし) | 購入履歴 HTML をスクレイピングして集計 |
| [kurorinchan/dlsite-purchased](https://github.com/kurorinchan/dlsite-purchased) | Python CLI | 2026-06-01(継続メンテ中) | Apache-2.0 | DLsite Play の非公開 JSON API を利用 |
| [AcrylicShrimp/dlsite-manager](https://github.com/AcrylicShrimp/dlsite-manager) | デスクトップアプリ(Tauri) | 2026-05-27(継続メンテ中) | LICENSE ファイルなし(README は無記載、要確認) | 複数アカウント横断のライブラリ管理・ダウンロード |
| [yt8492/SeihekiAnalyzer](https://github.com/yt8492/SeihekiAnalyzer) | Java/Docker CLI | 2019-07-14 | なし | 購入履歴からジャンル傾向分析 |
| [hanebarla/dlsite-analysis](https://github.com/hanebarla/dlsite-analysis) | 個人analysis | 2023-12-21 | MIT | 個人用の購入解析、参考程度 |
| [yodhcn/dlsite-doujin-renamer](https://github.com/yodhcn/dlsite-doujin-renamer) | Python CLI | 未調査(表層のみ) | 未確認 | RJ/VJ/BJ 番号から商品ページを取得しファイル名を整形。商品ページスクレイピングの参考実装 |

### darekasan/dlsite-userbuy — 詳細

ブラウザ DevTools コンソールに `dlst.js` を貼り付けて実行する形式。ログイン済みセッションの Cookie をそのまま利用する。

- **対象ページ**: `https://www.dlsite.com/maniax/mypage/userbuy/=/type/all/start/all/sort/1/order/1/page/{n}` (`type` セグメントを差し替えるとジャンル別カテゴリに絞れる)
- **ページネーション**: `.page_no ul li:last-child a` の `data-value` 属性から最終ページ番号を取得
- **一覧の行セレクタ**: `.work_list_main tr:not(.item_name)`
  - `work.url` = `.work_name a` の `href`(存在しない場合は販売終了扱い)
  - `work.date` = `.buy_date`
  - `work.name` = `.work_name`
  - `work.genre` = `.work_genre span`
  - `work.price` = `.work_price`(数字以外を除去してパース)
  - `work.makerName` = `.maker_name`
- **詳細モード**(`detailMode = true`)では各作品ページも取得し `.main_genre a` からジャンルタグを収集
- 非 JPY 通貨や複数ページ購入履歴での崩れが既知の未修正課題

### kurorinchan/dlsite-purchased — 詳細

Python(requests ベース)。DLsite Play の非公開 JSON API を直接叩く方式で、HTML スクレイピングより壊れにくい設計。継続的にメンテされている(2026-06 時点で push あり)。

- **ログイン**: `GET https://login.dlsite.com/login` → `XSRF-TOKEN` Cookie 取得 → `POST` で `_token` / `login_id` / `password` を送信、成功判定は `PHPSESSID` Cookie の有無。Cookie ファイル(`cookies.txt`)を直接渡す運用も可
- **購入一覧 API**: `GET https://play.dlsite.com/api/purchases?page={n}`(ページネーション、レスポンスに `total`/`limit`/`offset`/`works` を含む)
- **購入点数**: `GET https://play.dlsite.com/api/v3/content/count?last=0`
- **購入履歴(日付リスト)**: `GET https://play.dlsite.com/api/v3/content/sales?last=0`
- **商品単体情報**: `GET https://www.dlsite.com/maniax/api/=/product.json?workno={RJ番号}&locale=ja-JP`(非公開 AJAX エンドポイント、`dlsite_extract.py` で商品ページ HTML + この JSON API を併用)
- ダウンロード・整理系サブコマンド(`download`/`clean`/`find`)も持つ

### AcrylicShrimp/dlsite-manager — 詳細

Rust(Tauri 2 + Svelte)のデスクトップアプリ。継続的にメンテされている(122 stars)。

- 「DLsite Play v3 APIs」を対象と明記(具体エンドポイントは `crates/dm-api` 内、README には非掲載)
- 複数アカウントの購入情報 + ローカルフォルダを統合管理、SQLite(SQLx)で永続化
- 認証情報は別ストア管理でアプリ本体の DB とは分離
- README にライセンス記載なし、リポジトリルートに `LICENSE` ファイルも存在しない(要問い合わせ、または再配布を伴わない参照のみに留める)

### その他

- **yt8492/SeihekiAnalyzer**: 2019 年で更新停止。ユーザーID/パスワードでログインし購入履歴を解析する古い実装。参考にはなるが現行の DLsite UI とは乖離している可能性が高い。
- **darekasan/dlsite-userbuy** 同様、非公式スクリプト全般はライセンス表記がないものが多く、コード流用時は個別に許諾確認が必要。

## FANZA / DMM

| リポジトリ | 種別 | 最終更新 | ライセンス | 概要 |
|---|---|---|---|---|
| [shirafukayayoi/DMM-PurchaseList](https://github.com/shirafukayayoi/DMM-PurchaseList) | Python(Playwright) CLI | 2025-02-01 | なし | 同人購入履歴を CSV 出力 |
| [ekuinox/fanza-total-spending-extension](https://github.com/ekuinox/fanza-total-spending-extension) | ブックマークレット/Chrome拡張(MV2想定) | 2021-11-17 | Apache-2.0 | 購入履歴ページから総額集計 |
| [hira777/dmm-history](https://github.com/hira777/dmm-history) | Chrome拡張(MV3, TypeScript) | 2026-07-27(継続メンテ中) | MIT | 商品**閲覧**履歴(購入履歴ではない)の保存・表示。MV3 拡張構成の参考実装として有用 |
| [miya/dmm-search3](https://github.com/miya/dmm-search3) | Python(公式Web API v3ラッパー) | 2021-04-29 | MIT | 公式 Affiliate API、購入履歴は対象外・商品検索用 |

### shirafukayayoi/DMM-PurchaseList — 詳細

Playwright ベース(2025-02 に Selenium から移行)。メール/パスワードでログインするため二段階認証環境では動作しない旨を明記。

- **ログイン URL**: `https://accounts.dmm.co.jp/service/login/password/=/path=SgVTFksZDEtUDFNKUkQfGA__`(`input[name="login_id"]` / `input[name="password"]` にフォーム入力)
- **対象ページ**: `https://www.dmm.co.jp/dc/-/mylibrary/`(マイライブラリ、無限スクロール型 SPA)
- **スクロール要素**: `.purchasedListArea1Znew` を `scrollTop` が変化しなくなるまで反復スクロールして全件ロード
- **データセレクタ**(CSS Modules のハッシュ付きクラス名 — ビルドごとに変わりうる点に注意):
  - タイトル: `.productTitle3sdi8`
  - サークル: `.circleName209pI`
  - 種別: `.default3EHgn`
- 出力: `output.csv`(タイトル,サークル,ジャンル)
- **注意**: ハッシュ付きクラス名は FANZA 側のフロントエンド再ビルドで容易に変わるため、実地調査チケットでは属性ベース・構造ベースのセレクタ代替(`aria-*`, `data-*`, DOM 位置)も併せて確認すべき

### ekuinox/fanza-total-spending-extension — 詳細

- **対象ページ**: `https://payment.dmm.co.jp/history/`(月ごとの購入履歴ページ)
- 月数分だけリクエストを発行するため大量アクセスになりうる、との注意書きあり(レートに関する自主的な配慮が必要)
- 具体的な DOM セレクタはソース未確認(ソース取得は今回未実施、実装は公開されている)

### hira777/dmm-history — 詳細(閲覧履歴だが MV3 実装の参考として記録)

購入履歴ではなく商品**閲覧**履歴を保存する拡張だが、TypeScript + Manifest V3 + `content_scripts` の構成が本プロジェクトのスタック(拡張=TypeScript, MV3)に近く、継続メンテされている点で構成の参考になる。

- `manifest_version: 3`
- `host_permissions`: `https://video.dmm.co.jp/*`, `https://www.dmm.co.jp/service/digitalapi/*`
- `content_scripts` は `video.dmm.co.jp/*`(動画フロア)を対象にしており、DLsite と組み合わせる同人・電子書籍系フロア(`dlsite` 相当の `FANZA同人`/`FANZAブックス`)とは異なるドメイン構成である点に注意。実地調査では同人/ブックス系フロアの URL・DOM を別途確認する必要がある
- ローカルストレージのみ使用、外部送信なしという設計方針は本プロジェクトの「購入データはローカル保持」方針と一致

### 公式 API(参考): DMM Web API v3 (Affiliate API)

購入履歴は取得できないが、商品メタデータ(タイトル・画像・価格)の正規化に使える可能性がある公式 API。

- エンドポイント: `https://api.dmm.com/affiliate/v3/ItemList?site=FANZA&service=digital&floor=videoa&cid={cid}&output=json&api_id=...&affiliate_id=...`
- API ID・アフィリエイト ID の登録が必要(署名不要、レート制限は緩め)
- `cid`(内部 content ID)と表示上の品番(メーカー型番、例 `MIDE-988`)は別物: `cid` は小文字プレフィックス+ゼロ埋め数字(例 `mide00988`)

## ID 形式まとめ

### DLsite: workno(作品ID)

`[プレフィックス][数字]` の形式。旧作品は6桁、新しめの作品は8桁の数字。

| プレフィックス | 意味 | URL パターン例 |
|---|---|---|
| `RJ` | 同人(同人ゲーム・ボイス・漫画など、maniax) | `https://www.dlsite.com/maniax/work/=/product_id/RJ######.html` |
| `RE` | 同人の英語版(DLsite 英語ストア) | 同上の英語ストア版 |
| `VJ` | 商業(美少女ゲーム等、pro) | `https://www.dlsite.com/pro/work/=/product_id/VJ######.html` |
| `BJ` | 商業書籍/コミック(BL・GL含む、GL は girls-pro にリダイレクト) | `https://www.dlsite.com/books/work/=/product_id/BJ######.html` |

正規表現の目安: `[BRV][JE]\d{6,8}`(要実地検証)。番号自体は連番で意味を持たない。

### FANZA(DMM): cid(コンテンツID) / 品番

- `cid` は URL・API で使われる内部識別子。小文字プレフィックス + ゼロ埋め数字(例: `mide00988`, `1vandr00069`)
- 画面表示の「品番」(メーカー型番、例 `MIDE-988`)とは別物。`cid` → 品番の対応は 1:1 とは限らない場合がある(要実地検証)
- 購入履歴ページ・マイライブラリ側の商品リンクにどちらの ID が使われているかは未確認 — 実地調査チケットで要確認

## 実地調査チケットへの示唆

- DLsite は「HTML スクレイピング(`darekasan/dlsite-userbuy` の `.work_list_main` 系セレクタ)」と「DLsite Play 非公開 JSON API(`kurorinchan/dlsite-purchased` の `play.dlsite.com/api/purchases`)」の 2 経路が存在する。API 経路の方が壊れにくく本プロジェクト向き。ログインセッション(Cookie)の取り扱い方式を実地で確認する必要あり。
- FANZA/DMM は購入履歴 UI が SPA 化しており(`DMM-PurchaseList` のクラス名がハッシュ付き)、CSS セレクタが不安定になりやすい。属性ベースのセレクタや、`accounts.dmm.co.jp` 側の認証フロー、マイライブラリ(`dmm.co.jp/dc/-/mylibrary/`)と `payment.dmm.co.jp/history/` のどちらが正の購入履歴ソースかを実地で切り分ける必要がある。
- 公式 Affiliate API(`api.dmm.com/affiliate/v3/ItemList`)は購入履歴には使えないが、`cid` から正規化用メタデータ(タイトル画像等)を補完する用途で使える可能性がある(要 API ID 取得の是非を検討)。
- ライセンス不明/なしのリポジトリが多い。コードの直接流用は避け、エンドポイント・セレクタの「事実」を参考にした独自実装とする。

## 出典

- [darekasan/dlsite-userbuy](https://github.com/darekasan/dlsite-userbuy)
- [kurorinchan/dlsite-purchased](https://github.com/kurorinchan/dlsite-purchased)
- [AcrylicShrimp/dlsite-manager](https://github.com/AcrylicShrimp/dlsite-manager)
- [yt8492/SeihekiAnalyzer](https://github.com/yt8492/SeihekiAnalyzer)
- [hanebarla/dlsite-analysis](https://github.com/hanebarla/dlsite-analysis)
- [yodhcn/dlsite-doujin-renamer](https://github.com/yodhcn/dlsite-doujin-renamer)
- [shirafukayayoi/DMM-PurchaseList](https://github.com/shirafukayayoi/DMM-PurchaseList)
- [ekuinox/fanza-total-spending-extension](https://github.com/ekuinox/fanza-total-spending-extension)
- [hira777/dmm-history](https://github.com/hira777/dmm-history)
- [miya/dmm-search3](https://github.com/miya/dmm-search3)
- DLsite Product Information Injector (Greasy Fork) — `product.json` API パターンの出典
