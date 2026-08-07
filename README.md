# AvoidDuplicatePurchases v1

DLsite／FANZAの購入済み作品を確認し、多重購入を避けるためのChrome Desktop用ツールです。

## 対応環境

- Google Chrome Desktop（Manifest V3）
- Node.js 22.x
- localhost server: `127.0.0.1:41321`

EdgeなどのChromium派生ブラウザは未検証、Firefoxは対象外です。

## インストール

公式配布経路はGitHub Releaseのassetsだけです。Releaseページから
`avoid-duplicate-purchases-vX.Y.Z.zip`をダウンロードし、任意の作業フォルダへ展開してください。
source checkoutやMarketplaceからの導入は対象外です。

### 初回セットアップ

対応環境はGoogle Chrome Desktop（Manifest V3）とNode.js 22.xです。Node.jsが未導入なら、
[Node.js 22.x](https://nodejs.org/en/download/)を導入してターミナルを開き直してください。

1. Chromeで `chrome://extensions` を開き、右上の **Developer mode** を有効にします。
2. **Load unpacked** を押し、展開したbundle内の `extension/` フォルダを選びます。
3. 読み込まれたAvoidDuplicatePurchasesのカードを開き、**ID** 欄の32文字（小文字 `a`〜`p`）を控えます。
4. ターミナルで、`package.json` があるbundle rootへ移動し、ガイドを起動します。

```sh
npm run setup
```

ガイドはNode.jsのversionを確認し、runtime依存を導入し、extension IDを検証してから
許可オリジンを `.adp/config.env` に保存し、localhost serverを起動します。最後に管理画面と
拡張機能の両方へ接続できるか確認します。失敗した場合は修正方法と `.adp/server.log` の場所を表示します。

設定ファイルにはextension IDなどの非秘密設定だけを保存します。再実行するとextensionの許可オリジンだけを更新し、
既存の `ADP_DB_PATH` など他の設定は残します。

```sh
npm start                    # 2回目以降の起動
npm run status               # server、管理画面、拡張機能の接続状態
npm run restart              # 停止してから起動
npm run stop                 # 停止
```

`npm start` はserverを管理対象のバックグラウンドプロセスとして起動します。PIDは `.adp/server.pid`、
serverの出力は `.adp/server.log` に保存されます。停止・再起動・状態確認はbundle rootから上記コマンドを実行してください。
`npm run status` で「管理画面」「拡張機能」がともに接続済みになれば利用できます。

```sh
http://127.0.0.1:41321/
```

管理画面を開き、拡張機能のポップアップにも「サーバー: 接続済み」と表示されることを確認してください。

### DBと更新

DBはbundle外の `~/.adp/data.sqlite` に保存されます。保存先を変える場合は `.adp/config.env` に
`ADP_DB_PATH=...` を追加または編集してください。`npm run setup`、`npm start`、`npm run stop`、
`npm run restart`、`npm run status` は既存DBを削除・上書きしません。Releaseを更新する前に、DBを別の場所へbackupしてください。
DB backupと復元の管理は利用者の責任です。

### 困ったとき

- `Node.js 22.xが必要` と表示されたら、Node.js 22.xを導入してターミナルを開き直します。
- 拡張機能が未接続なら、`chrome://extensions` の現在のIDを確認して `npm run setup` を再実行します。
- serverが起動しない、またはポートが使用中なら `npm run status` と `.adp/server.log` を確認し、管理対象なら `npm run restart` を実行します。
- `npm ci` が失敗したら、ネットワーク接続とbundle root（`package.json` と `package-lock.json` がある場所）を確認します。

## 配布範囲と制約

公式配布経路はGitHub Release assetsだけです。Chrome Web Store／Edge Add-ons／Firefox Add-onsなど別の配布経路への公開や、運用環境への配布は行いません。FANZA video／PC gamesのページ介入、全ブラウザ行列、autostart、自動backupはv1の対象外です。

upstreamの非公開APIが変わった場合は、後続Releaseでの更新が必要になることがあります。
