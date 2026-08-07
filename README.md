# AvoidDuplicatePurchases v1

DLsite／FANZAの購入済み作品を確認し、多重購入を避けるためのChrome Desktop用ツールです。

## 対応環境

- Google Chrome Desktop（Manifest V3）
- Node.js 22.x
- localhost server: `127.0.0.1:41321`

EdgeなどのChromium派生ブラウザは未検証、Firefoxは対象外です。

## インストール

GitHub Releaseの配布bundleを展開します。

```sh
node --version                 # 22.x
```

1. Chromeで `chrome://extensions` を開き、Developer modeを有効にします。
2. `extension/` を「Load unpacked」で読み込みます。
3. 表示されたextension IDを控えます。
4. bundle rootでruntime依存を導入します。

```sh
npm ci --omit=dev
```

5. 控えたextension IDを使い、bundle rootでserverを起動します。

```sh
ADP_EXTENSION_ORIGIN=chrome-extension://<extension-id> npm start
```

6. `http://127.0.0.1:41321/` を開き、管理画面とextensionのlocalhost接続を確認します。停止はforegroundの `npm start` を `Ctrl-C` で終了します。

DBはbundle外の `~/.adp/data.sqlite` に保存されます。保存先を変える場合だけ `ADP_DB_PATH` を指定してください。更新前のDB backupは利用者の責任です。

## 配布範囲と制約

公式配布経路はGitHub Release assetsだけです。Chrome Web Store／Edge Add-ons／Firefox Add-onsなど別の配布経路への公開や、運用環境への配布は行いません。FANZA video／PC gamesのページ介入、全ブラウザ行列、autostart、自動backupはv1の対象外です。

upstreamの非公開APIが変わった場合は、後続Releaseでの更新が必要になることがあります。
