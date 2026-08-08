# Issue #43 Amazon（Kindle）一次資料調査

- 対象: [GitHub Issue #43](https://github.com/geekjapan/AvoidDuplicatePurchases/issues/43)
- 調査日: 2026-08-07
- 前提更新日: 2026-08-08
- 調査範囲: Amazon / Kindle の公式ヘルプ、公式開発者ドキュメント、公式利用規約・プライバシー規約のみ
- 目的: 実装前に、Kindle の対象範囲、地域・アカウント前提、取得経路、利用権の状態、識別子、規約・プライバシー制約を確定する

## 結論

1. **初期対象は Amazon.co.jp の Kindle 電子書籍だけ**にする。紙書籍、Audible、動画、音楽、端末、雑誌・新聞、Personal Documents などは対象外とする。Kindle Unlimited や Prime Reading の Kindle 電子書籍が同じライブラリに現れても、購入とは別の利用権として扱う。
2. **1 回の同期は、利用者本人が選択した 1 つの Amazon アカウントと 1 つのマーケットプレイスに束縛**する。Amazon は同じアカウントで Kindle ライブラリを表示すると説明しており、国・地域の変更では購入コンテンツの移管や Kindle Unlimited の自動返却が起きるためである。
3. **公式の消費者向け Kindle ライブラリ API または機械可読エクスポートは、今回確認した一次資料では確認できない。** Amazon の公開 Creators API は商品カタログ用で、利用者の購入履歴・Kindle ライブラリを返す操作は API リファレンスで確認できない。非公開 API の存在や利用許可は推測しない。
4. **公式 UI は取得候補だが、第三者による自動抽出が許可されているとは扱わない。** Amazon の公式ヘルプが案内する「コンテンツと端末の管理」は利用者が Kindle コンテンツを管理する正規の画面である。一方、Amazon の利用規約は、明示的な書面許可なしのデータマイニング、ロボット、類似のデータ収集・抽出を制限している。したがって、利用者のクリックを起点にした DOM 読み取りも、クリックだけで規約上許可されたことにはならない。
5. **購入済みと確認できない行は購入済みにしない。** 購入、無料取得、サンプル、貸出・レンタル、Kindle Unlimited、Prime Reading、判定不能を別状態に保存する。
6. **照合キーは `(marketplace, ASIN, format=kindle_book)` を基本にする。** ASIN 単独、タイトル単独、ISBN 単独、注文番号単独を購入済み判定のキーにしない。

## 追加で確定したユーザー前提

Issue #43 の追加回答により、調査・実装検討の入力を次のように固定する。

- マーケットプレイスは **Amazon.co.jp のみ**、対象アカウントは **単一アカウント**とする。
- 取得経路は、Amazon の規約・仕様が許す範囲で、利用者起点の手動操作・公式 UI・公式 API / エクスポートを候補にする。利用者が「可能な限りすべて」を許可しても、Amazon 側の規約や明示的な許可を置き換えるものではない。
- 所有扱いは、公式の購入履歴として確認できる Kindle 本の購入と **0 円購入**。レンタル、貸出、Kindle Unlimited、Prime Reading、返品・返金済みは所有扱いにしない。
- 利用者が指定した入口は [Amazon.co.jp の「コンテンツと端末の管理」Books 一覧](https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll/) である。この URL は認証済みの利用者向け UI の入口であり、公式 API、エクスポート、DOM、内部 JSON の仕様を示す資料ではない。
- データが公開されないことを条件に、非公開クラウドホスティングを許容する。ただし、リポジトリの既存方針（`docs/spec.md` のローカル限定）とは差分があるため、実装前にプロジェクト方針を明示的に整合させる。今回の研究では `docs/spec.md` を変更しない。

## 1. Kindle-only scope

Amazon の Kindle Store Terms of Use は「Kindle Content」を本・新聞・雑誌などを含むデジタルコンテンツとして定義している。したがって「Kindle 対応」をそのまま全 Kindle Content と解釈すると対象が広すぎる。[Kindle Store Terms of Use](https://digprjsurvey.amazon.co.uk/csad/help/node/201014950)

Issue #43 の最初の対象は、次の条件を同時に満たす **Kindle 電子書籍**に限定する。

- Amazon の商品・ライブラリ表示が Kindle Book / Kindle 電子書籍である
- 紙版・ハードカバー・Audible など別フォーマットではない
- ライブラリ上の状態を、下記の利用権状態のいずれかとして判定できる

Amazon の公式ヘルプでも、Kindle Store は Kindle books を提供し、購入後に Kindle へ配信すると説明されている。また、Amazon の KDP ヘルプは電子書籍を検索する際に「Kindle ストア」を選択するよう案内している。[Buy Books on Your Kindle E-Reader](https://digprjsurvey.amazon.co.uk/csad/help/node/TzALG6ortKDoQIRnMf)、[本を Amazon で見つける方法](https://kdp.amazon.co.jp/ja_JP/help/topic/GPYDJ3SECAVVPNVG)

## 2. Regions and account assumptions

### 推奨する初期前提

- マーケットプレイスは **Amazon.co.jp** のみ
- 1 回の同期は、利用者本人が選択した 1 つの Amazon アカウントのみ
- Household / Family Library、別アカウント、別地域のコンテンツを同一の購入履歴として自動統合しない
- Amazon.co.jp 以外は、マーケットプレイスごとの検証と規約確認が済むまで未対応

Amazon の公式資料は Kindle ストアを国・地域ごとに扱っている。KDP の配信権ヘルプでは JP Kindle ストアの地域を日本として列挙し、米国、英国、ドイツなどを別の Kindle ストアとして列挙している。[電子書籍の配信権](https://kdp.amazon.co.jp/ja_JP/help/topic/G200652410)

Amazon は、同じ Amazon アカウントで Kindle にサインインするとそのアカウントのライブラリが表示されると説明している。[How to get to my Kindle library](https://www.aboutamazon.com/news/devices/how-to-find-your-kindle-library)

国・地域を変更した場合、Amazon は購入済み Kindle コンテンツを新しいローカルマーケットプレイスへ移管できる一方、Kindle Unlimited は移管できず、借りているタイトルを自動返却すると説明している。[Transfer Your Kindle Content to Another Country or Region](https://digprjsurvey.amazon.co.uk/csad/help/node/GV8CGUYJHXQ6C6MJ)

Kindle Unlimited の対象国・地域もマーケットプレイス単位で列挙され、Amazon.co.jp については Japan と記載されている。[Kindle Unlimited Eligible Countries and Territories](https://digprjsurvey.amazon.co.uk/csad/help/node/TryGuDEBL4T8YoFxJ1)

**実装上の結論:** 外部キーには ASIN だけでなく `marketplace` を含める。アカウントのメールアドレスや Amazon 内部のアカウント ID は、照合キーとして保存・表示しない。地域変更後は差分同期ではなく、少なくとも利用権状態を再確認する必要がある。

## 3. Permitted acquisition path

### 公式に確認できた経路

Amazon の公式ヘルプは、サインインした利用者が「Manage Your Content and Devices / コンテンツと端末の管理」で Books を表示し、端末への配信や削除を行う手順を案内している。同じ画面で、Digital Orders の支払い完了状態も確認するよう案内している。[Troubleshoot Kindle Content Not Appearing in Your Library](https://digprjsurvey.amazon.co.uk/csad/help/node/TsdpGRrbNmNohmj2Q9)

これは **利用者が自分の Amazon アカウントを操作する公式 UI** である。今回の指定 URL はその Amazon.co.jp 側の入口である。ただし、公式ヘルプが第三者アプリに対してその画面の一覧を抽出する許可を与えているわけではなく、認証後の画面構造・項目名・ページング・エクスポートは今回の公開一次資料では確認できない。

### 公式 API について

現在の Amazon Creators API の公式資料が示す操作は、`GetItems`、`SearchItems`、`GetVariations`、`GetBrowseNodes` などの商品カタログ操作である。[Creators API API Reference](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference)

Creators API は Amazon Associates への参加、対象マーケットプレイスの承認、認証情報、Partner Tag を前提とし、商品を発見して Amazon へ送客する用途として説明されている。[Creators API Introduction](https://affiliate-program.amazon.com/creatorsapi/docs/)、[Register for Creators API](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/onboarding/register-for-creators-api)、[Best Programming Practices](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/concepts/best-programming-practices)

今回確認した Creators API の公式 API リファレンスには、サインインした消費者の Kindle 購入履歴、Manage Your Content and Devices のライブラリ、サンプル、貸出、Kindle Unlimited の利用権を返す操作は **確認できない**。PA-API 5 も公式告知では 2026-05-15 に非推奨となり Creators API への移行が案内されている。[PA-API 5 Deprecation Notice](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/paapiv5-deprecation)

### 許容判断

| 経路 | この調査での判断 |
|---|---|
| Amazon が将来提供する公式 API / 公式エクスポート | それが利用規約・仕様で個人ライブラリの取得を許可している場合だけ採用候補。今回その仕様は確認できない。 |
| 利用者が Amazon の公式画面を開き、本人が手動で確認・入力する | 利用者操作としては公式 UI の範囲。ただし、自動取り込みの許可とは別。 |
| 利用者のクリック後に拡張機能が DOM を自動収集する | **許可済みとは判定しない。** Amazon の規約上の書面許可または明確な API ライセンスを確認するまで実装しない。 |
| Amazon のログインフォームに資格情報を入力させる、Cookie / MFA を保存する | 採用しない。 |
| 非公開エンドポイント、Kindle 内部 API、定期クロール | 採用しない。公式仕様・許可を確認できないため。 |

Amazon.co.uk の現行 Conditions of Use & Sale は、Amazon Service のコンテンツの抽出・再利用を明示的な書面許可なしに行うこと、特にデータマイニング、ロボット、類似のデータ収集・抽出ツールを使うことを制限している。[Conditions of Use & Sale](https://digprjsurvey.amazon.co.uk/csad/help/node/GLSBYFE9MGKKQXXM)

Creators API についても、Amazon の Associates Program IP License は、Program Content の利用を同プログラムの範囲に限定し、データマイニング・ロボット等をライセンスに含めていない。[Amazon Associates Program Policies / IP License](https://affiliate-program.amazon.com/help/operating/policies/#Associates%20Program%20IP%20License)

**結論:** 「利用者操作を起点にする」ことは、バックグラウンド同期を避けるための必要条件にはできるが、十分条件ではない。Issue #43 の自動同期は、Amazon が明示する個人ライブラリ API / エクスポート、または Amazon からの明示的な許可が確認できるまで実装着手しない。

## 4. Ownership / access states

Amazon の Kindle Store Terms of Use は、Kindle Content を「販売」ではなくライセンスとして提供し、個人・非商用での利用を認める。以下の `purchased` は法的な所有権ではなく、**Amazon 上で購入取引が完了し、購入による利用権が確認できた状態**を意味する。[Kindle Store Terms of Use](https://digprjsurvey.amazon.co.uk/csad/help/node/201014950)

| 保存する状態 | 判定条件 | 重複購入判定 |
|---|---|---|
| `purchased` | Digital Order が完了し、Kindle 電子書籍としてライブラリにあることを公式表示から確認できる | 購入済みとして扱う。ただし返金・削除・利用停止の状態は別途保持する。 |
| `free` | 0 円の注文・購入履歴として確認できる。現在の商品価格が 0 円というだけでは判定しない | ユーザー要件上、購入済み照合の対象に含める。Amazon は無料キャンペーンを公式に説明している。[本の販促](https://kdp.amazon.co.jp/ja_JP/help/topic/G201723090)、[Amazon UK Associates Commission Income](https://affiliate-program.amazon.co.uk/help/node/topic/GRXPHT8U84RAYDXZ) |
| `returned` | Kindle 本の注文が返品・返金済みで、公式の注文またはコンテンツ管理状態から確認できる | **所有扱いにしない。** Amazon は返品・返金後は本へのアクセスがなくなると説明している。[Return a Kindle Book Order](https://digprjsurvey.amazon.co.uk/csad/help/node/G937D322PWZ6L9BL?theme=light) |
| `sample` | 「Read sample / Look Inside」などのプレビューだけ | **購入済みとして扱わない。** Amazon はサンプルを購入前のプレビューと説明し、eBook のサンプル量も別に定義している。[Read Sample](https://kdp.amazon.com/en_US/help/topic/G200644250) |
| `loan` / `rental` | 一定期間だけ借りている、または貸出中であることが表示される | **購入済みとして扱わない。** Kindle 本の貸出機能は購入者が他人へ貸す機能で、14 日間、1 タイトル 1 回、購入数には算入されない。公式資料では Amazon.com 購入本のみで、日本ではサポートされないと記載されている。[本の貸し出し](https://kdp.amazon.co.jp/ja_JP/help/topic/G200652240)、[本の販促](https://kdp.amazon.co.jp/ja_JP/help/topic/G201723090) |
| `kindle_unlimited` | Kindle Unlimited バッジ、フィルター、または返却可能な KU 利用権として確認できる | **購入済みとして扱わない。** KU は最大 20 タイトルを借りられ、アクティブな会員資格の間だけ利用する Subscription Content である。[Learn About Kindle Unlimited](https://digprjsurvey.amazon.co.uk/csad/help/node/GTQEND3RFAFNLKU5)、[Kindle Store Terms of Use](https://digprjsurvey.amazon.co.uk/csad/help/node/201014950) |
| `prime_reading` | Prime Reading として追加され、返却可能なタイトル | **購入済みとして扱わない。** Prime Reading は回転するカタログから最大 10 タイトルを借りる機能で、Manage Your Content and Devices から返却する。[Learn About Prime Reading](https://digprjsurvey.amazon.co.uk/csad/help/node/TtC9Z3sc6iHu2naNQA) |
| `unknown` | タイトル、表紙、現在価格、ダウンロード済みという情報だけで、取得形態が判定できない | 購入済みとして扱わない。利用者に確認を求めるか、未確定として保存する。 |

Kindle Unlimited や Prime Reading の返却はライブラリからタイトルを除去する操作であり、購入本の「削除」と同じ意味ではない。状態と確認日時を分けて保持し、見えなくなったことだけから購入取消し・所有喪失を推定しない。[Remove Books from Your Mobile Kindle App](https://digprjsurvey.amazon.co.uk/csad/help/node/GTJVXWTHLYEA8UUE)

## 5. Stable identifiers

### 推奨キー

`(marketplace, asin, format=kindle_book)`

Amazon の公式開発者ドキュメントは、ASIN を Amazon が割り当てる 10 文字の英数字の識別子と説明し、商品詳細ページの `/dp/<ASIN>` と商品情報欄から確認できるとしている。また、マーケットプレイスごとに商品詳細ページを管理し、各ロケールの ASIN を記録するよう案内している。[Alexa Shopping Actions: 商品 ID](https://developer.amazon.com/ja-JP/docs/alexa/alexa-shopping/implement-shopping-actions.html)

Amazon.co.jp の公式 Associates ヘルプも、ASIN はカタログ上の商品を識別する 10 桁の番号で、商品詳細ページに表示されると説明している。書籍でも ISBN が使われる場合と ASIN が使われる場合がある。[Amazon.co.jp 商品リンク / ASIN](https://affiliate.amazon.co.jp/help/topic/t5/a3)

### 使い分け

- **ASIN:** Amazon カタログ上の Kindle 版を指す主識別子。Kindle 版かどうかを別の `format` 判定で確認する。
- **Marketplace:** `amazon.co.jp` などの販売地域。ASIN が同じように見える場合でも、地域ごとのカタログ、価格、提供可否、利用権を混ぜない。
- **ISBN / EAN:** 取得できれば照合用メタデータとして保存するが、Kindle 版・紙版・翻訳版・版違いの同一性を単独で決めない。
- **Parent ASIN:** 所有判定のキーにしない。Amazon の公式 API 資料では、Parent ASIN は子 ASIN の抽象で、購入できず offer に紐付かないと説明されている。[ParentASIN](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/resources/parent-asin)
- **タイトル / 著者:** 他ストアとの作品照合の候補情報に留め、Amazon の購入済み判定キーにしない。
- **Amazon 内部の content ID / asset ID:** 今回の公式資料では安定性・第三者利用許可を確認できないため採用しない。

これは Amazon の商品識別子と、プロジェクトが外部参照を `(source, cid)` で持つ方針を対応させた推奨である。実装時に Amazon 用 `source` を追加する場合でも、`cid` に ASIN を入れるだけでなく marketplace と Kindle format を同時に保持する。

## 6. Privacy and terms constraints

Amazon のプライバシー通知は、購入履歴、コンテンツ・デバイス・サービス設定、コンテンツのダウンロードや利用、ログイン情報などを個人情報の例として扱い、アカウント上で購入履歴等へアクセスできると説明している。[Amazon Privacy Notice](https://digprjsurvey.amazon.co.uk/csad/help/node/GX7NJQ4ZB8MHFRNJ?theme=light)

実装する場合の最低限の制約は次のとおり。

- Amazon のパスワード、Cookie、セッション、MFA コードを収集・保存しない
- 公開サイトへ Amazon のページ内容、メールアドレス、注文番号、住所、決済情報を送信しない。非公開クラウドを採用する場合も、アクセス制御・暗号化・保存期間・削除手順を別途定義する
- 非公開クラウド可という今回のユーザー要件は、`docs/spec.md` のローカル限定方針と異なる。研究段階では後者を変更せず、実装前にどちらを採用するか決める
- 実アカウント情報や実データをリポジトリへ入れない
- Kindle 本のファイル、サンプル本文、DRM 情報を取得・保存・再配布しない。Kindle の規約は DRM の回避を禁じ、DRM フリー本の EPUB/PDF ダウンロードも認証済み購入者に限り、Kindle Unlimited 等の利用者には提供しないと説明している。[Digital Rights Management](https://kdp.amazon.co.jp/ja_JP/help/topic/GDDXGH9VR22ACM8U)
- 非公開 API の逆解析、ログイン自動化、バックグラウンドの巡回、規約で許可されないデータ抽出を行わない
- Amazon の規約、API、画面表示は変更され得る。公式 Kindle Terms はカタログが常に変化すると説明しており、実装前に対象マーケットプレイスの最新規約を再確認する。[Kindle Store Terms of Use](https://digprjsurvey.amazon.co.uk/csad/help/node/201014950)

Creators API をメタデータ補完に使う案も、現時点では採用候補にしない。公式資料上は Associates の商品送客用途であり、Program Content の利用範囲、キャッシュ、データ抽出に制約がある。[Amazon Associates Program Policies / IP License](https://affiliate-program.amazon.com/help/operating/policies/#Associates%20Program%20IP%20License)、[Creators API Best Programming Practices](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/concepts/best-programming-practices)

## 残る限界と実装ゲート

- 公式資料で確認できたのは、利用者向けの Kindle ライブラリ UI と商品カタログ API である。**個人の Kindle 購入履歴・ライブラリを第三者アプリへ返す公式 API または公式 CSV/JSON エクスポートは確認できない。** 「存在しない」とは断定しない。
- 指定された Amazon.co.jp の Books 一覧 URL は利用者向けの公式入口として記録できるが、認証後の画面項目・状態値・安定した DOM / 内部 ID / エクスポートの公開仕様は確認できない。URL の提示だけでは自動取得の許可も確認できない。
- Manage Your Content and Devices の DOM、内部 JSON、内部 ID、ページング仕様は、今回の一次資料では安定仕様として確認できない。実地観測で補う場合も、規約上の許可を先に確認する。
- Kindle 本の貸出機能は公式資料上 Amazon.com のみで、日本ではサポートされない。Amazon.co.jp を初期対象にする場合、`loan` / `rental` は通常の購入経路として扱わず、表示された場合だけ非購入状態として保存する。
- 公式規約にはマーケットプレイスごとの差がある。ここでは Amazon.co.jp の地域・ASIN・貸出資料と、参照可能だった Amazon の英語圏消費者規約を併用した。Amazon.co.jp の実装を公開する前に、日本向けの最新 Kindle Terms と Conditions of Use の確認を実施する。

**実装着手条件:** Amazon が個人ライブラリ取得を明示的に許可する公式 API / エクスポート、または Amazon の明示的な許可が確認できること。利用者自身の許可と非公開クラウドの選択だけではこの条件を満たさない。そこまでは、Issue #43 は研究結果をもって取得経路未確定と扱い、購入済み推測を伴うコードを追加しない。
