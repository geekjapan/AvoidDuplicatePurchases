# Issue #46: 楽天Kobo 調査

調査日: 2026-08-07
対象: 楽天Kobo（日本向け）と、比較のための Kobo.com の eBook / Kobo Plus

## 結論

- 日本向けの対象サービスは、楽天IDでログインする楽天Kobo電子書籍ストア（`books.rakuten.co.jp/e-book/`）とする。購入本は楽天IDに紐づくマイライブラリで確認できる。[楽天Koboとは？](https://books.rakuten.co.jp/info/introduction/e-book/index-sp.html)
- Kobo Plus は購入ではなく購読アクセスである。公式の Available Countries 一覧に日本はなく、日本向けに有効な Kobo Plus と断定できないため、v1 では `unknown / unsupported until verified` とする。[Kobo Plus: Common questions](https://help.kobo.com/hc/en-us/articles/360018976153-Kobo-Plus-Common-questions)
- Kobo の「購入」はコンテンツ所有権ではなく、アカウントに紐づくアクセスライセンスである。購入済み、無料、プレビュー、Kobo Plus、予約、アーカイブを別状態にする。[Privacy Policy](https://authorize.kobo.com/terms/privacypolicy)、[購入特約](https://books.rakuten.co.jp/info/e-book/purchaseagreement/index-sp.html)
- 正規に確認できる購入履歴の経路は、ログイン後の公式 UI（Kobo.com の Purchase History）である。しかし Terms は page-scrape、robot、spider、data mining 等を禁止する。購入履歴・My Books の自動収集を許可された経路とは判断できず、Kobo の明示的許可、公式 API、または公式 export 仕様が確認されるまで実装対象にしない。[Purchase History](https://help.kobo.com/hc/en-us/articles/360017753854-View-your-audiobook-and-eBook-purchase-history)、[Terms of Use](https://authorize.kobo.com/terms/termsofuse)
- 書籍単位は、地域・ストア固有の `Book ID` / 日本側の `商品番号` を文字列で保存し、表示される ISBN/eISBN があれば別フィールドに保存する。シリーズには表示名と巻番号はあるが、公式の安定した series ID は確認できない。[Kobo Writing Life metadata](https://www.kobo.com/kobo-writing-life/blog/metadata-101)

## 1. 地域・サービス範囲

### 確認できたこと

- 楽天Kobo日本向けストアは、楽天ブックス内の電子書籍販売サービスで、購入には楽天IDが必要である。購入本は楽天IDに紐づいて管理され、マイライブラリから確認できる。[楽天Koboとは？](https://books.rakuten.co.jp/info/introduction/e-book/index-sp.html)
- Kobo は地域によって販売可否を判定する。Privacy Policy は請求先情報と IP ベースの位置情報を地域判定に使うと説明し、Kobo Plus は請求先を別国へ変更すると新規タイトル追加を止め、請求期間終了後に購読をキャンセルすると説明する。[Privacy Policy](https://authorize.kobo.com/terms/privacypolicy)、[Kobo Plus: Common questions](https://help.kobo.com/hc/en-us/articles/360018976153-Kobo-Plus-Common-questions)
- 通常の Kobo Store の購入不可国リストには中国、ロシア、ウクライナ等が含まれるが、日本は含まれていない。[Countries where you cannot purchase items from the Kobo Store](https://help.kobo.com/hc/en-us/articles/360046398554-Countries-where-you-cannot-purchase-items-from-the-Kobo-Store)
- Kobo Plus の現行公式一覧には、カナダ、米国、英国、台湾、香港などはあるが日本はない。[Kobo Plus: Common questions](https://help.kobo.com/hc/en-us/articles/360018976153-Kobo-Plus-Common-questions)
- 日本の顧客は、購入本を Kobo eReader / Kobo app と同期して読むことはできるが、Kobo の公式ヘルプでは DRM ファイルとしてダウンロードできない。[Download books from your Kobo account](https://help.kobo.com/hc/en-us/articles/360019527954-Download-books-from-your-Kobo-account-to-export-to-another-device-or-app)

### unknown / inference

- Kobo Plus の一覧に日本がないことは、日本で提供されるという根拠がないことを示すが、一覧ページが日本を明示的に unavailable としているわけではない。日本アカウントの実 UI で有効表示が確認されるまでは対象外扱いにする。
- グローバル Kobo.com の Purchase History と楽天Kobo日本向けマイライブラリが同一の取得面かは、公式資料だけでは確認できない。日本向けは楽天ID・日本向け利用規約のサービス境界を優先する。

## 2. Kobo Plus と所有・アクセス状態

Kobo の Privacy Policy は、購入・取得を「Digital Content にアクセスするライセンス」と説明し、アカウント保有者は Digital Content を所有せず、コピー・譲渡権も得ないとしている。[Privacy Policy](https://authorize.kobo.com/terms/privacypolicy)

| 状態 | 一次資料で確認できる表示・意味 | 重複購入判定 |
|---|---|---|
| `purchased` | Kobo.com の Purchase History に購入済み eBook / audiobook が表示される。購入後は Library に同期される。[Purchase History](https://help.kobo.com/hc/en-us/articles/360017753854-View-your-audiobook-and-eBook-purchase-history)、[Buy eBooks and audiobooks](https://help.kobo.com/hc/en-us/articles/360017767333-Buy-eBooks-and-audiobooks-on-Kobo-com) | 購入アクセス権として重複候補にする。ただし「所有権」と表示しない |
| `preorder_pending` | 予約は Purchase History に追加されるが、発売日に課金され、その後 Library に入る。[Pre-order eBooks and audiobooks](https://help.kobo.com/hc/en-us/articles/360017741053-Pre-order-eBooks-and-audiobooks-from-the-Kobo-store) | 課金・発売前は購入済みと断定しない |
| `kobo_plus_access` | 対象本には `Read with Kobo Plus` が表示され、購読者は `Add to My Books` で追加できる。[Kobo Plus: Common questions](https://help.kobo.com/hc/en-us/articles/360018976153-Kobo-Plus-Common-questions)、[Add Kobo Plus titles](https://help.kobo.com/hc/en-us/articles/360018811754-Add-Kobo-Plus-titles-from-kobo-com) | 購入済みではない。購読アクセスとして別表示 |
| `kobo_plus_expired` | 購読を解約すると Kobo Plus 本へのアクセスがなくなる。[Kobo Plus: Common questions](https://help.kobo.com/hc/en-us/articles/360018976153-Kobo-Plus-Common-questions) | 過去のアクセスと現在の権利を分離 |
| `free_access` | 商品ページに `Free eBook` と `Add to My Books` が表示される例がある。[Kobo product page](https://www.kobo.com/us/en/ebook/vanished-193) | 無料であることだけでは購入履歴とみなさない |
| `preview` | 購入前に短いサンプルを読める `Preview now` がある。[Read a preview](https://help.kobo.com/hc/en-us/articles/360017513434-Read-a-preview-on-your-Kobo-eReader) | 所有・購入・購読アクセスに数えない |
| `archived` | My Books から Archive に移せ、後で Library に戻せる。[Manage books](https://help.kobo.com/hc/en-us/articles/360018102733-Manage-books-in-your-Kobo-account)、[Restore missing books](https://help.kobo.com/hc/en-us/articles/360017959374-Restore-missing-books-or-audiobooks-on-your-Kobo-account) | 表示状態と購入記録を分離 |

日本向けには、楽天IDまたは Rakuten Kobo ユーザーアカウントを失うと購入した閲覧視聴権を使えなくなる場合がある、と購入特約にある。[Rakuten Kobo電子書籍購入特約](https://books.rakuten.co.jp/info/e-book/purchaseagreement/index-sp.html) したがって `purchased` も「永久に読めるファイル」ではなく、確認時点のライセンス状態として扱う。

## 3. 許可された取得経路

### 公式に案内された経路

- 通常購入は、商品ページの `Buy Now` またはカートから checkout する。[Buy eBooks and audiobooks](https://help.kobo.com/hc/en-us/articles/360017767333-Buy-eBooks-and-audiobooks-on-Kobo-com)
- Kobo.com では、ログイン後に `My Account → Purchase History` で購入済み eBook / audiobook を確認できる。[Purchase History](https://help.kobo.com/hc/en-us/articles/360017753854-View-your-audiobook-and-eBook-purchase-history)
- 楽天Kobo日本向けでは、楽天IDに紐づくマイライブラリで購入本を確認する。[楽天Koboとは？](https://books.rakuten.co.jp/info/introduction/e-book/index-sp.html)
- 日本の公式 BooCa 規約では、販売店で購入したシリアルコードを Kobo アカウントへ入力して対象タイトルをダウンロードする経路がある。[BooCa サービス利用規約](https://books.rakuten.co.jp/e-book/booca/kiyaku/)
- Kobo の `Download file` は購入済みコンテンツを他社端末へ export する手順であり、購入履歴の metadata export / API ではない。日本顧客には DRM ファイル download の制約もある。[Download books from your Kobo account](https://help.kobo.com/hc/en-us/articles/360019527954-Download-books-from-your-Kobo-account-to-export-to-another-device-or-app)

### Terms 上の線引き

Kobo の Terms は、データ検索・robots・類似のデータ収集/抽出方法を許諾に含めず、`deep-link`、`page-scrape`、`robot`、`spider`、その他の自動 device / program / algorithm / methodology による Service / Site Content の取得・監視を禁止している。[Terms of Use](https://authorize.kobo.com/terms/termsofuse)、[楽天Kobo利用規約](https://books.rakuten.co.jp/info/e-book/termofuse/)

したがって、次は今回の調査では「許可された取得経路」と扱わない。

- ログインセッションを使う Purchase History / My Books の自動 page-scrape
- 非公開 endpoint の逆解析・直接呼び出し
- 購入・購読・アカウント操作の自動化
- Kobo の Site Content を別データベースへ継続収集すること

公式資料を調査した範囲では、個人の購入履歴を取得する公開 API / CSV export / partner API の仕様は確認できなかった。よって、Kobo に明示的な許可または公式インターフェースを確認するまで、Issue #46 の自動取り込みは保留とする。

## 4. 安定した book / volume / series 識別子

### 確認できる値

- **Kobo global の `Book ID`**: 商品ページに表示される商品単位の識別値。ISBN-13 と一致する例もある一方、別の数字列になる例もあるため、常に ISBN と解釈しない。[Kobo product page: Agnes's Rescue](https://www.kobo.com/ca/en/ebook/agnes-s-rescue)、[Kobo product page: Vanished](https://www.kobo.com/us/en/ebook/vanished-193)
- **楽天Kobo日本向けの `商品番号`**: 例として『鬼滅の刃 1』の商品ページは `4970100805337` を表示する。[楽天Kobo 鬼滅の刃 1](https://books.rakuten.co.jp/rk/cc86b86093ac33e9b126d33ecc3b2d80/)
- **ISBN / eISBN**: 表示される場合は電子版の ISBN を別に保存する。Kobo Writing Life は、ISBN を入力しない場合に Kobo ISBN を割り当て、印刷版 ISBN を partner site で print/eBook を並べるために使うと説明している。[The A to Z of KWL](https://www.kobo.com/kobo-writing-life/blog/the-a-to-z-of-kwl)
- **volume**: `Series Book n` / `Book n` や series metadata の巻番号として表示される。Kobo Writing Life は series name と volume number を同じ metadata として入力し、巻番号には 0 や小数も使えると説明している。[Metadata 101](https://www.kobo.com/kobo-writing-life/blog/metadata-101)
- **series**: series name と巻番号、シリーズ内リンクは観測できる。しかし、公式の stable series UUID / series ID 仕様は確認できなかった。[Metadata 101](https://www.kobo.com/kobo-writing-life/blog/metadata-101)

### 取り込み時の推奨表現

1. `source`（例: `rakuten-kobo-jp` / `kobo-global`）と region / locale を必ず保存する。
2. `source_item_id` は日本側の `商品番号`、global 側の `Book ID` を文字列で保存する。URL の slug は provenance 用で、永続性を仮定しない。
3. 表示された ISBN/eISBN は `isbn13` 等に正規化するが、Book ID と同一視しない。
4. title、author、language、publisher、release date、format、DRM、series name、volume number を補助 metadata とする。
5. `purchased`、`kobo_plus_access`、`free_access`、`preview` は商品 ID とは別の entitlement state として保存する。

### unknown / inference

- Kobo が `Book ID` を全地域・全フォーマットで不変と保証する公開仕様は見つからなかった。ストア固有キーとしては使えるが、他ストアと直接比較しない。
- series name と volume number はリンク用 metadata であり、安定した series identifier ではない。名前だけでシリーズ同一性を断定しない。
- ISBN/eISBN が別ストアでも一致する場合に同一版候補とするのは、書誌 metadata に基づく推論であり、Kobo が保証するクロスストア照合ではない。

## 5. クロスストア照合の証拠

公式 UI の実例として、『鬼滅の刃 1』は楽天Koboとebookjapanの双方に掲載されている。

- 楽天Koboはタイトル、著者、シリーズ名、出版社、発売日、商品番号 `4970100805337` を表示する。[楽天Kobo 鬼滅の刃 1](https://books.rakuten.co.jp/rk/cc86b86093ac33e9b126d33ecc3b2d80/)
- ebookjapanはタイトル、著者、出版社、掲載誌/レーベル、提供開始日 `2016/6/17`、ページ数、シリーズ内リンクを表示し、URL内の識別子は `367324/A001650413` である。[ebookjapan 鬼滅の刃 1巻](https://ebookjapan.yahoo.co.jp/books/367324/A001650413/)

これは title + author + publisher + release date + volume の複合 evidence が同一作品候補を作れることを示すが、ストア ID は一致しない。したがって判定は次の順にする。

1. 同一版の ISBN/eISBN が両ストアに表示され、title、author、language、format も一致する場合: 高信頼候補。
2. ISBN がない場合: title、author、publisher、release date、volume、format を複合比較し、セット/全集/番外編/翻訳/改訂版を除外できる場合だけ候補。
3. `Book ID`、日本側商品番号、ebookjapan の URL ID はストア固有なので、単独一致・単独不一致を作品同一性の根拠にしない。
4. Kobo Plus / 無料 / プレビューの表示は、作品同一性ではなく当該アカウントの entitlement state として比較する。

## 6. プライバシー・Terms 制約

- Kobo の Privacy Policy は、username / password、IP、購入・アクセスした Digital Content、subscription、transaction、検索・閲覧履歴、読書活動、端末情報、請求先地域などを Personal Information の例として挙げる。[Privacy Policy](https://authorize.kobo.com/terms/privacypolicy)
- Kobo は認証、取引、地域判定、同期、推薦・広告、セキュリティ等にこれらを利用し、Rakuten ID や retailer partner を使う場合はアカウント情報を連携することがある。[Privacy Policy](https://authorize.kobo.com/terms/privacypolicy)
- 日本向け利用規約は、楽天IDとパスワードを秘密に保持し、アカウント上の作業について利用者が責任を負うとしている。[楽天Kobo利用規約](https://books.rakuten.co.jp/info/e-book/termofuse/)
- Terms は Site Content の複製・送信・再配布、data mining / page-scrape 等を制限する。[Terms of Use](https://authorize.kobo.com/terms/termsofuse)

安全側の triage 要件（後半は本調査からの推奨）:

- パスワード、決済情報、Cookie、電子書籍本体、読書履歴を取り込まない。
- 公式許可が得られた場合でも、目的最小限の書誌 metadata と entitlement state だけをローカル保持し、外部送信・共有・継続監視をしない。
- 取得対象、保存期間、削除方法を利用者に明示し、Kobo の規約変更時に再確認する。

## Triage verdict

Issue #46 の通常購入・重複判定の要件は、`rakuten-kobo-jp`、購入アクセス権、store-local item ID、ISBN/eISBN、series metadata、明確な非購入状態に分解できる。一方、公式 Terms と整合する自動購入履歴取り込みの取得経路は確認できない。次の判断は、Kobo へ公式 API / export / 個人利用許可を問い合わせ、許可が得られるまで自動取り込みを対象外にすることとする。

## Sources

すべて公式一次資料または各ストアの first-party observable interface（アクセス日: 2026-08-07）。

- [楽天Koboとは？](https://books.rakuten.co.jp/info/introduction/e-book/index-sp.html)
- [楽天Kobo利用規約](https://books.rakuten.co.jp/info/e-book/termofuse/)
- [Rakuten Kobo電子書籍購入特約](https://books.rakuten.co.jp/info/e-book/purchaseagreement/index-sp.html)
- [BooCa サービス利用規約](https://books.rakuten.co.jp/e-book/booca/kiyaku/)
- [View your audiobook and eBook purchase history](https://help.kobo.com/hc/en-us/articles/360017753854-View-your-audiobook-and-eBook-purchase-history)
- [Kobo Plus: Common questions](https://help.kobo.com/hc/en-us/articles/360018976153-Kobo-Plus-Common-questions)
- [Download books from your Kobo account](https://help.kobo.com/hc/en-us/articles/360019527954-Download-books-from-your-Kobo-account-to-export-to-another-device-or-app)
- [Terms of Use](https://authorize.kobo.com/terms/termsofuse)
- [Privacy Policy](https://authorize.kobo.com/terms/privacypolicy)
- [Metadata 101](https://www.kobo.com/kobo-writing-life/blog/metadata-101)
- [The A to Z of KWL](https://www.kobo.com/kobo-writing-life/blog/the-a-to-z-of-kwl)
- [楽天Kobo 鬼滅の刃 1](https://books.rakuten.co.jp/rk/cc86b86093ac33e9b126d33ecc3b2d80/)
- [ebookjapan 鬼滅の刃 1巻](https://ebookjapan.yahoo.co.jp/books/367324/A001650413/)
