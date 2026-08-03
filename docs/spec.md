# 重複購入回避ツール — スペック

ステータス: **承認済み**(2026-08-03、Issue #8)
根拠となる決定: 地図 #1 の Decisions so far(#2〜#7, #9)。本書はそれらを統合し、残っていた未決事項を確定させる。実測の詳細は各プロトタイプの README を正とする。

- DLsite 調査: `prototype/dlsite/README.md`(#4)
- FANZA 調査: `prototype/fanza/README.md`(#5)
- 正規化検証: `prototype/normalize/README.md`(#7)
- カート削除: `prototype/cart-delete/README.md`(#9)

---

## 1. 目的とスコープ

DLsite と FANZA(同人・ブックス・動画・PCゲーム=dlsoft)での**サイト横断の重複購入を、購入前に気づかせて防ぐ**。

- 介入面: 対象サイトの商品ページ・一覧・カートに「購入済み」表示。カートは警告 + ワンクリック削除(undo 付き)。
- 履歴: 拡張が各サイトの購入履歴 API を読み取りローカル DB に登録(初回バックフィル + 差分)。
- 管理画面: 履歴閲覧・検索、照合候補のレビュー、手動訂正、手動登録、エクスポート。
- 前提: R-18 サイト対応。購入データはローカル保持のみ、外部送信しない。

**第一波の介入対象**: DLsite、FANZA 同人、FANZA ブックス(#3)。動画・PCゲームは**履歴取り込みのみ**(介入は後続波)。

## 2. アーキテクチャ

```
┌──────────────┐  fetch(サイト Cookie)   ┌──────────────┐
│ ブラウザ拡張   │ ───────────────────→ │ 各サイト API   │
│ (Chrome MV3)  │                        └──────────────┘
│  content script│
│  service worker│ ←── HTTP(127.0.0.1) ──→ ┌──────────────┐
└──────────────┘                          │ ローカルサーバ │──── SQLite
┌──────────────┐                          │ (Node/TS)     │
│ 管理画面(SPA) │ ←──── 同サーバが配信 ────│               │
└──────────────┘                          └──────────────┘
```

- **言語は TypeScript 統一**。モノレポ(npm workspaces): `extension/` `server/` `shared/`。
- `shared/` = 正規化ロジック + 各店舗レスポンスのパーサ(アダプタのパース側)+ API 型定義。
- **フェッチは拡張、パース・保存・照合はサーバ**。サイト API はログイン済みブラウザセッション Cookie が必須なので、拡張の service worker が fetch し、生レスポンスをそのままサーバへ POST する。サーバが `shared/` のパーサで解釈して保存する。
- サーバは `127.0.0.1` の固定ポート(既定 41321、設定可)にバインド。管理画面は同サーバが静的配信(`http://127.0.0.1:41321/`)。

## 3. データモデル(#6 で確定)

`work`(属性なし)/ `listing`(行の存在 = 所有)/ `match_key`(導出データ)の 3 テーブル。DDL は #6 の決定どおり:

```sql
CREATE TABLE work (
  id INTEGER PRIMARY KEY
);

CREATE TABLE listing (
  id       INTEGER PRIMARY KEY,
  source   TEXT NOT NULL CHECK (source IN
             ('dlsite','fanza_doujin','fanza_books','fanza_video','fanza_dlsoft')),
  cid      TEXT NOT NULL,              -- DLsite=workno, FANZA=cid
  work_id  INTEGER NOT NULL REFERENCES work(id),
  work_id_locked INTEGER NOT NULL DEFAULT 0,   -- 1 = 手動確定、rematch 対象外

  title      TEXT NOT NULL,
  maker_name TEXT,
  series_id  TEXT,                     -- ブックスの URL 生成に必須、他は NULL
  image_url  TEXT,

  purchased_at TEXT,                   -- ISO8601 / NULL 可
  purchased_at_precision TEXT NOT NULL DEFAULT 'unknown'
             CHECK (purchased_at_precision IN ('second','day','unknown')),

  raw_json    TEXT NOT NULL,
  imported_at TEXT NOT NULL,

  UNIQUE (source, cid)
);
CREATE INDEX listing_work ON listing(work_id);

CREATE TABLE match_key (
  listing_id INTEGER NOT NULL REFERENCES listing(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                  -- 'title' | 'maker'(#7)
  key  TEXT NOT NULL,
  PRIMARY KEY (listing_id, kind, key)
);
CREATE INDEX match_key_lookup ON match_key(kind, key);
```

- 取り込みは **upsert のみ、削除しない**(配信終了でも所有の事実は消えない)。
- `work.id` は rematch をまたいで不安定。外部参照は常に `(source, cid)`。
- 収録関係は将来 `work_relation(parent_work_id, child_work_id, kind)` を後付けする余地だけ確保(§10)。
- **マイグレーション**: `PRAGMA user_version` + 連番 SQL ファイル(`server/migrations/NNN.sql`)を起動時に順次適用。ツールは入れない。

## 4. 取り込み(店舗アダプタ)

店舗ごとにアダプタ 1 つ。**フェッチ側(拡張)** と **パース側(shared)** に分かれる。エンドポイント・レスポンス形式の正は各調査 README。

| source | 履歴取得 | 差分 | 購入日精度 |
|---|---|---|---|
| `dlsite` | `GET play.dlsite.com/api/v3/content/sales?last=0`(全件一括)+ 公開 `product.json` でメタ補完 | `last=` カーソル | `second` |
| `fanza_doujin` | `GET /dc/doujin/api/mylibraries/`(page/limit≤100) | 全ページ再取得 → upsert | `day`(和暦風文字列パース) |
| `fanza_books` | `ajax/bff/library/`(シリーズ)→ シリーズごと `contents/`(N+1) | 同上 | `second`(ISO8601) |
| `fanza_video` | GraphQL `ppvLibrary`(offset/limit) | 同上 | `unknown`(NULL) |
| `fanza_dlsoft` | `dlsoft /ajax/v1/library` | 同上 | `unknown`(NULL) |

- DLsite の `product.json` は未ログイン公開 API なので**サーバ側から直接**取得してよい(拡張を経由しない)。取得不可の workno(販売終了等)は履歴側の情報のみで登録する。
- FANZA ブックスの `shop_name` は `all`(一般向け book.dmm.com も含める — 重複回避の目的では正しい)。
- 動画の `latestViewingRightsAcquiredAt` は購入日として信用しない(#6)。`raw_json` にのみ残す。
- **トリガー**: 拡張ポップアップの「同期」ボタン(手動)+ `chrome.alarms` による 1 日 1 回の自動差分同期。同期結果(新規件数・エラー)はポップアップに表示。

## 5. 照合と正規化(#7 で確定)

2 段構え:

1. **自動マージ**: 正規化キー(`kind='title'`)の**完全一致のみ**。
2. **候補キュー**: dice ≥ 0.7 かつ正規化メーカー名(`kind='maker'`)一致のペアを管理画面に出し、**人が ○×** を付ける。○ = 同一 work にマージ、× = 別物と確定。どちらも対象 listing を `work_id_locked=1` にする。

- 正規化ルールは L1(NFKC 等)→ L2(店舗版マーカー denylist)→ L5(巻数・話数)→ L3(記号全除去)→ L4(かな正規化)。**ブラケット一律除去は禁止**(`shared/` のセルフチェックで固定済み)。
- `rematch` = match_key 全再構築 + 未ロック listing の work 再割り当て(冪等)。ルール変更時・取り込み後に実行。候補キュー生成は rematch 後のバッチ。
- 閾値は上げない・自動化を広げない。誤報(未購入品を購入済み表示)は取り返しがつかない、が判断基準。

## 6. 拡張の介入 UI

対象: DLsite maniax、FANZA 同人、FANZA ブックス。cid 抽出は `og:url` / `canonical` が本線。

### 商品ページ

購入ボタン近傍にバナーを 1 枚挿入:

- **同一サイトで購入済み**(`(source, cid)` が DB にある): 「✓ 購入済み(2023-12-30)」
- **他サイトで購入済み**(タイトル+メーカーの正規化キーが他 source の listing に完全一致): 「⚠ 他サイトで購入済み: DLsite『(タイトル)』」— 当該商品ページへのリンク付き。**完全一致のみ**で出す(候補レベルでは出さない。§5 の誤報基準と同じ)。

### 一覧・検索ページ

サムネイル角に小さいオーバーレイバッジ(✓)。同一サイト `(source, cid)` 一致のみ(一覧からタイトル・メーカーを確実に取るのは店舗ごとに DOM が違い脆いため、横断照合は商品ページとカートに限定)。一覧の DOM フックは店舗ごとに実装時に確認(#5 の注意事項)。

### カート

カートページを開いたらカート API(#4/#5 で確定、DLsite のみ DOM パース)で cid 一覧を取得し、サーバへ照合:

- 重複(同一・他サイト購入済み)行に**警告バッジ + 「削除」ボタン**を表示。
- 削除クリック → 削除 API(#9 の表)→ **トースト「削除しました — 元に戻す」を約 10 秒表示**。「元に戻す」= 復元 API。確認ダイアログは出さない。自動削除はしない(#1)。
- 削除・復元はカートページ上でのみ実行(同人 `_token`・ブックス `own_url` などページ文脈依存値があるため)。アダプタは `remove(cids)` / `restore(cids)` の薄い抽象 1 枚、DLsite だけ cid ごとの GET ループ。
- **実装フェーズの最初のタスクとして、安価な商品 1 件で削除→復元の実叩き確認を行う**(#9 で未実施。ユーザー立ち会いで)。

### サーバ未起動時

照会が失敗したら**何も表示しない**(壊れたバッジやエラーバナーは出さない)。ポップアップのアイコンバッジでのみ未接続を示す。

## 7. ローカル API(拡張・管理画面 ⇔ サーバ)

JSON/HTTP。パスは `/api/` 配下。境界での入力検証(zod 等 1 つ)を必須とする。

| エンドポイント | 用途 |
|---|---|
| `POST /api/lookup` | `{items: [{source?, cid?, title?, maker?}]}` → 各項目の判定 `{owned, other: [{source, cid, title, url}]}`。cid 照合とタイトル横断照合を 1 本で受ける |
| `POST /api/import/:source` | 拡張が取得した生レスポンス(ページ単位)を受け取り、パース→upsert→match_key 再計算。戻りは `{inserted, updated}` |
| `GET /api/sync-state/:source` | 差分同期用カーソル(DLsite `last=` 等)と前回同期時刻 |
| `GET /api/candidates` / `POST /api/candidates/:id` | 候補キューの取得 / ○× 確定 |
| `POST /api/rematch` | 再照合の実行 |
| `GET /api/listings` | 検索・一覧(管理画面) |
| `POST /api/listings/manual` | 手動登録(商品 URL → cid 抽出、`product.json` 等でメタ補完) |
| `POST /api/listings/:source/:cid/work` | 手動の結合・分離(`work_id` 書き換え + lock) |
| `POST /api/export` | §9 のエクスポート実行 |

### 保護方式(確定事項)

- `127.0.0.1` バインドのみ。認証トークンは**持たない**。
  - 根拠: 脅威は (a) 同一マシンの他プロセスと (b) 悪意ある Web ページ。(a) は SQLite ファイルを直接読めるため、トークンがあっても守れない(OS ユーザー境界が実際の防御線)。(b) はブラウザが防ぐ(下記)。トークンは拡張への初回貼り付け UX を増やすだけで防御を足さない。
- (b) への対策: 拡張は **service worker からのみ** API を呼ぶ(`host_permissions` に `http://127.0.0.1:41321/*`)。サーバは **CORS ヘッダを一切返さず**、`Origin` ヘッダが存在するリクエストのうち拡張オリジン(`chrome-extension://<id>`)と管理画面(同一オリジン)以外を 403 で拒否。Chrome の Private Network Access も公開サイト→localhost を遮断する。
- エラーレスポンスに内部パス・スタックトレースを含めない。

## 8. 管理画面

サーバが配信する SPA(フレームワークは実装時に選定、`shared/` の型を使う)。画面は 4 つ:

1. **ライブラリ**: listing の一覧・検索(タイトル/メーカー/source)。work 単位のグルーピング表示。行から結合・分離(= `work_id` 書き換え + lock)。誤バッジの訂正はここで行う。
2. **候補キュー**: dice ≥ 0.7 ペアをカードで並べ、○(同一)/ ×(別物)。処理済みは消える(lock により再出現しない)。
3. **同期**: 各 source の最終同期時刻・件数・エラー、rematch 実行ボタン、手動登録フォーム(URL 貼り付け)。
4. **設定**: ポート、エクスポート先フォルダ、エクスポート実行。

## 9. エクスポートと他マシン同期(確定事項)

- **単方向・単一書き込み機**とする。メイン機だけが取り込み・訂正を行い、`VACUUM INTO '<エクスポート先>/adp-export.sqlite'` で同期フォルダ(Google Drive 等)へ書き出す。エクスポートは設定画面から手動 + 同期成功後に自動。
- サブ機はサーバを **read-only モード**(設定フラグ)で起動し、同期フォルダの DB を直接開く。バッジ・カート警告は機能する。取り込み・訂正 API は 403。
- 双方向マージはしない。lock の衝突・work_id の不安定性(#6)を跨いだマージは複雑さに見合わない。サブ機で訂正したくなったらメイン機でやる。
- 形式は SQLite ファイルそのもの(raw_json 込みで完全な複製)。別形式(CSV 等)の書き出しは要求が出るまで作らない。

## 10. スコープ外・将来

- **収録関係(単話⊂単行本、バンドル・総集編)の検知は v1 に含めない。** 判断材料(`work_pack_parent` 等)は `raw_json` に保存済みで、`work_relation` テーブルの後付けで対応可能。別 effort として再訪する。
- FANZA 動画・PCゲームの**ページ介入**(バッジ・カート)は後続波。
- 3 サイト目以降の追加は、本書のアダプタ分割(フェッチ側/パース側/カート側)に従って追加する。それ以上の標準化(プラグイン機構等)はしない。
- Firefox 対応、モバイル、クラウド同期サービス化はスコープ外。

## 11. リスクと前提

- **非公開 API 依存**: 各サイトの API は無告知で変わる(#4 で実例: 旧 `api/purchases` 廃止)。`raw_json` 保存と upsert 設計により、パーサ修正 + 再同期で追随する。拡張はサイト側の変化で**静かに壊れる**前提で、同期エラーをポップアップに出す。
- **アカウント安全性**: 全 API はユーザー自身のセッション Cookie で、ユーザー操作起点 + 1 日 1 回の同期のみ。レート制限を刺激する連打はしない(取り込みはページ単位で逐次)。
- **プライバシー**: 購入データはローカル SQLite と同期フォルダのみ。テレメトリ・外部送信なし。リポジトリは public のため、実データ・実 ID をコミットしない(`.gitignore` 済みの実データ運用を継続)。
- **手動登録は `(source, cid)` 必須**(#6 の前提)。cid の無い購入を登録したい要求が出たら再訪。

## 12. 実装チケットへの分割の目安(参考)

1. モノレポ雛形 + `shared/` 正規化(プロトタイプ `normalize.mjs` の TS 移植 + セルフチェック)
2. サーバ: スキーマ + マイグレーション + `import`/`lookup`/`rematch`
3. 拡張: フェッチアダプタ 5 種 + 同期(手動 + alarm)
4. カート削除の実叩き確認(1 件)→ カート介入 UI
5. 商品ページ・一覧バッジ
6. 管理画面(ライブラリ → 候補キュー → 同期・設定)
7. エクスポート + read-only モード
