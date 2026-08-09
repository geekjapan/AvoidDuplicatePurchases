# Issue #44: ebookjapan 調査

調査日: 2026-08-07

対象: [#44 ebookjapanを購入履歴と重複照合の対象に追加する](https://github.com/geekjapan/AvoidDuplicatePurchases/issues/44)

## 結論

- 対象は `ebookjapan.yahoo.co.jp` のWeb版と、ユーザー自身のYahoo! JAPAN IDに紐づくデータに限定する。ebookjapanはLINE Digital Frontier株式会社が運営する電子書籍サービスで、Webサイト用コイン規約はアカウントをYahoo! JAPAN IDと定義している。[公式の内容・注意事項](https://ebookjapan.yahoo.co.jp/info/notice/)、[Webサイト用コイン規約](https://ebookjapan.yahoo.co.jp/info/webcoin-terms/)
- 公式に案内されている取得経路は、ログイン後のWeb版「マイページ > 購入履歴」。Web版とアプリ版の履歴は分かれている。[購入履歴ヘルプ](https://support.yahoo-net.jp/SaiEbookjapan/s/article/H000012800)、[ログイン/ログアウト](https://support.yahoo-net.jp/SccEbookjapan/s/article/H000012792)
- ebookjapanの購入履歴を取得する公開パートナー/API仕様は、調査範囲では**確認できない**。Yahoo!デベロッパーネットワークのAPI一覧にもebookjapanの購入履歴APIは掲載されていない。[APIドキュメント一覧](https://developer.yahoo.co.jp/sitemap/)
- 現在の公式Webクライアントには、ログイン済みで購入履歴を読む内部リクエストが観測できる。ただし、これは公開APIまたは利用許諾を意味しない。実装するなら同一ブラウザのユーザーセッションだけを使い、規約・サービス提供者の許諾を別途確認する必要がある。[公式クライアントJS（2026-08-07観測）](https://ebookjapan.yahoo.co.jp/_nuxt/D2hjhBuc.js)、[観測した内部URL](https://ebookjapan.yahoo.co.jp/proxy/apis/user/purchaseHistory?results=50&start=0)
- よって、現時点の判定は「条件付き候補」。購入済みと断定できるのは、ユーザー自身の購入履歴に購入記録がある商品だけとし、無料・試し読み・レンタル・ギフトは別状態で保持する。

## トリアージ回答

| 質問 | 結論 | 根拠・限界 |
|---|---|---|
| サービス/地域 | `ebookjapan.yahoo.co.jp` Web版。アカウント単位はYahoo! JAPAN ID。海外の全地域対応は確認できないが、Yahoo! JAPANの海外利用制限ではEEA/英国でもebookjapanは利用可能な例外として列挙されている。 | [ログイン/ログアウト](https://support.yahoo-net.jp/SccEbookjapan/s/article/H000012792)、[海外からの利用](https://support.yahoo-net.jp/PccOverseasuse/s/article/H000013813)。EEA/英国以外の国別可否、決済可否、配信権の地域差は公式資料から確定できない。 |
| コンテンツ種別 | 紙ではなく電子書籍。単行本・冊、合本版、分冊版、話・連載を含み、漫画、小説、文芸・実用、雑誌・グラビア、アダルト等のカテゴリがある。シリーズ画面は複数巻をまとめて表示する。 | [内容・注意事項](https://ebookjapan.yahoo.co.jp/info/notice/)、[本棚の使い方](https://ebookjapan.yahoo.co.jp/info/bookshelf-instruction/)、[トップ](https://ebookjapan.yahoo.co.jp/)。同じ作品名でも別シリーズ・別版になり得るため、シリーズ名だけで同一商品とは扱わない。[商品情報の修正要望](https://support.yahoo-net.jp/SccEbookjapan/s/article/H000013747) |
| 正規の取得経路 | 公式に説明されているのは、ユーザーがYahoo! JAPANにログインしてWeb版の購入履歴を見る経路。現行クライアントはログイン後に `/proxy/apis/user/purchaseHistory`、旧履歴画面に `/proxy/apis/user/purchaseHistory/ebj` を使うことが観測できる。 | 公式API/パートナー仕様としては**確認できない**。内部URLの利用が許可されているとの記載もない。未ログインの直接リクエストは `externalId is invalid` で失敗したため、公開・匿名APIではない。[購入履歴ヘルプ](https://support.yahoo-net.jp/SaiEbookjapan/s/article/H000012800)、[公式クライアントJS](https://ebookjapan.yahoo.co.jp/_nuxt/D2hjhBuc.js) |
| 購入 | Web版の購入履歴に注文・商品がある状態。購入後は本棚に登録される。購入履歴を正の所有根拠とし、単に商品ページを見たことや本棚の表示だけでは購入済みと推測しない。 | [本棚の使い方](https://ebookjapan.yahoo.co.jp/info/bookshelf-instruction/)、[購入した書籍が本棚にない](https://support.yahoo-net.jp/SccEbookjapan/s/article/H000013375) |
| 無料 | 作品詳細で「無料」と表示され、無料で読める状態。アプリヘルプには「1冊無料」を端末にダウンロードできる説明もある。購入ではない。 | [無料作品の閲覧](https://support.yahoo-net.jp/SccEbookjapan/s/article/H000013066)、[オフラインで読みたい](https://support.yahoo-net.jp/SaaEbookjapan/s/article/H000012865) |
| 試し読み/期間限定無料 | 購入ではない。単行本・冊は期間限定無料で読んだだけなら本棚に登録されない。連載は無料読書履歴に登録されるため、読書履歴を購入履歴と混同しない。 | [本棚の使い方](https://ebookjapan.yahoo.co.jp/info/bookshelf-instruction/)。試し読みの具体的な保持期間・レスポンス状態値は確認できない。 |
| レンタル | Web版ではWebサイト用コインをレンタルに使え、本棚にも「レンタル中」絞り込みがある。購入とは別の一時利用権として扱う。 | [Webサイト用コイン](https://support.yahoo-net.jp/SccEbookjapan/s/article/H000014438)、[本棚の使い方](https://ebookjapan.yahoo.co.jp/info/bookshelf-instruction/)、[内容・注意事項](https://ebookjapan.yahoo.co.jp/info/notice/)。正確なレンタル期限と履歴レスポンスの状態値は確認できない。 |
| ギフト/プレゼント | 本棚には購入本だけでなくプレゼントなどで獲得した本も登録される。現行の購入履歴画面もプレゼント受取履歴を合わせて表示する。読める権利と本人の購入事実を別状態にする。 | [本棚の使い方](https://ebookjapan.yahoo.co.jp/info/bookshelf-instruction/)、[購入履歴クライアント](https://ebookjapan.yahoo.co.jp/_nuxt/BPjNTSLG.js) |
| アプリ/別ストア | iOSアプリは未ログイン購入が端末に紐づく場合があり、Web版購入履歴とは別。Webサイト用コインもアプリでは使えない。Yahoo!ショッピング版等をWeb版履歴に含める根拠は確認していない。 | [未ログイン購入（iOS）](https://support.yahoo-net.jp/SaiEbookjapan/s/article/H000013129)、[Webサイト用コイン](https://support.yahoo-net.jp/SccEbookjapan/s/article/H000014438) |

## 識別子

公式資料が「永続的な書籍ID」と保証する識別子は**確認できない**。ただし、公開商品画面と公式クライアントで次のキーが観測できる。

- 商品ページの正規URL例は `https://ebookjapan.yahoo.co.jp/books/723083/A004684967/`。`723083` はタイトル側の数値キー、`A004684967` は商品ページの `publicationCd` として使われている。[公式商品ページ](https://ebookjapan.yahoo.co.jp/books/723083/A004684967/)
- 公式クライアントのルーティングと履歴画面は `publicationCd` を商品ページへのリンクに使う。商品ページの埋め込みデータには `bookCd` と `goodsCd` もあるが、公式に永続性・意味が説明された資料は確認できない。[公式クライアントJS](https://ebookjapan.yahoo.co.jp/_nuxt/D2hjhBuc.js)
- 同じ商品ページの構造化データではISBNが空の例を確認したため、ISBNを必須の主キーにしない。[公式商品ページ](https://ebookjapan.yahoo.co.jp/books/723083/A004684967/)

実装候補を置く場合も、`(source=ebookjapan, publicationCd)` を**暫定キー**とし、`titleId`、`bookCd`、`goodsCd`、正規URL、取得元レスポンスを補助情報として保持する。正式な安定性が未確認なので、認証済み購入履歴の実データを使った検証なしに「安定ID」と確定してはならない。

## 取得範囲と限界

- 購入履歴ヘルプは過去365日分を案内する一方、別の不正購入ヘルプは過去2年分と案内しており、公式ヘルプ内で保持範囲が一致しない。[購入履歴ヘルプ](https://support.yahoo-net.jp/SaiEbookjapan/s/article/H000012800)、[不正購入ヘルプ](https://support.yahoo-net.jp/SccEbookjapan/s/article/H000014308)
- したがって、初回同期で全購入履歴が取れるとは保証できない。取得できた範囲を同期結果として表示し、未取得期間を購入なしと解釈しない。
- 本棚から削除した本は「削除した本」から戻せるため、本棚の現在表示だけを差分削除の根拠にしない。[本棚の使い方](https://ebookjapan.yahoo.co.jp/info/bookshelf-instruction/)
- 公式資料から、購入・無料・試し読み・レンタルを一貫して判別する公開レスポンススキーマ、レンタル期限フィールド、履歴全件のエクスポート方法は確認できない。

## 規約・プライバシー上の制約

LINEヤフー共通利用規約は、コンテンツの利用権をサービス利用目的に限定し、画面上で「購入」と表示されても権利そのものは移転せず、予定された利用態様を超える複製・送信等を禁止している。また、サービスや構成データを提供目的を超えて再利用すること、サーバー・ネットワークへの妨害、BOT等による不正操作、過度な利用、第三者の利用履歴の収集、他人のアカウントやパスワードの利用・提供を禁止している。[LINEヤフー共通利用規約](https://www.lycorp.co.jp/ja/company/terms/)

LINEヤフーのプライバシーポリシーは、購入したサービス等を含む利用状況をパーソナルデータとして扱い、第三者提供は同意または適用法上認められる場合等に限るとしている。[LINEヤフープライバシーポリシー](https://www.lycorp.co.jp/ja/company/privacypolicy/)

このIssueの実装を再開する場合の最低条件は次のとおり。

1. ユーザー自身のログイン済みブラウザセッションだけを使い、パスワード・Cookie・Yahoo! JAPAN IDを取得・保存・外部送信しない。
2. ebookjapanの購入履歴から必要なメタデータと状態だけを読み、電子書籍本文・画像データを取得、複製、共有しない。
3. 内部URLを使う場合は、公式APIとして扱わず、アクセス頻度を抑え、仕様変更・利用停止に耐えるエラー表示を用意する。実装前にサービス提供者への許諾確認を行う。
4. 購入履歴、注文番号、アカウント識別子等の個人情報を公開Issue、リポジトリ、ログ、外部同期へ出さない。ローカル保存の範囲も必要最小限にする。

## トリアージ判断

取得経路とデータ状態は一部確認できたが、公式API、安定IDの保証、履歴保持範囲、レンタル期限、第三者クライアントによる内部URL利用許諾は確認できない。したがって、Issue #44をそのまま実装着手可能とは判断しない。サービス提供者の許諾または取得範囲を明示した追加判断と、匿名化された認証済みレスポンスの確認が必要である。

## 実装メモ（2026-08-08、Issue #44 reader 実装）

上記の調査は研究時点の結論であり、変更しない。本実装はユーザー承認記録（`.orca/workflows/dom-sync-20260808/decisions/browser-dom-and-price-scope.md`）と可視 DOM 観測記録（同 `visible-dom-selector-observations.md`）に基づき、承認された範囲だけを実装する。

- **登録**: `extension/src/content/ebookjapan-library.ts` の `ebookjapanLibraryPageReader`（`source: "ebookjapan"`）を foundation の `LibraryPageReader` registry へ登録（`library.ts` のブラウザ実行時ガード内）。Amazon reader の挙動は変更しない。
- **URL ゲート**: HTTPS + `ebookjapan.yahoo.co.jp` + 厳密な `/bookshelf` または `/bookshelf/` パスのみ。query は無し、または単一の正の整数 `page` パラメータのみ許可する（`page` 以外の query キー、重複 `page`、空・非正値は不許可）。サブパス（`/bookshelf/all` 等）・追跡 query・ハッシュ・資格情報は fail closed（`login`）。ゲートを通過した URL だけを `page` のみの canonical 形（trailing slash 付き path）へ正規化する。
- **シェル認識**: 観測済みの `h1.heading__main`、`ul.tab-menu-list`、`#wd_temp_shelf-main`、`.shelf-control__amount` が揃うまで `page_not_ready`。空本棚は `.zero-message.zero-message--shelf` の可視テキスト `本がありません` のみで `empty`。
- **タブ境界**: アクティブタブが `購入済み` のときだけ purchased へ写像する。`無料読書履歴` は `free` に留め、購入済みへ昇格しない。アクティブ判定不能・別タブは `page_not_ready`（fail closed）。
- **項目境界**: 観測契約に非空アイテム markup が無いため、棚内の実在する可視 HTTPS 商品リンク（`/books/<titleId>/<publicationCd>/`、research #44 の公開 URL 形）だけを境界にする。`publicationCd` を暫定 `cid`、リンク可視テキスト（または img alt）を title とする。商品リンクが無ければ推測せず `page_not_ready`。URL の title/ID からの合成はしない。
- **状態写像（保守的）**: 無料読書履歴タブは `free`、購入済みタブ上の商品リンクは `purchased` とする。現時点で観測済みの項目 markup に専用の状態要素がないため、タイトルやリンク文言に含まれる レンタル / 立ち読み・サンプル / ギフト / 予約 / 読み放題 / 無料 を状態判定へ使わない（購入済みタイトルの文言を誤って非購入扱いにしない）。専用 status 要素を観測・承認するまで、複数のアクティブタブや判定不能なタブは `page_not_ready` に倒す。価格フィールドは出力しない。
- **画像・商品 URL**: 絶対 http(s)・資格情報なしの `img[src]` のみ `imageUrl`。`productUrl` は実在する HTTPS ebookjapan 商品リンクの origin+path のみ。
- **ページング**: 可視の同一ホスト bookshelf リンクに正の `?page=N` が明示されているときだけ次 URL を返す。ラベルだけから次ページを合成しない。visited/max-page ガードは background 共通層。非表示 API・手動ページ送りは使わない。
- **残課題**: 非空アイテムの安定したカード markup（著者/出版社セレクタ、バッジ位置、ページャ DOM）は観測契約に未収録。実棚の追加観測で境界を厚くできるが、未観測セレクタの推測は行わない。
