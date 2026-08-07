# Release Distribution

AvoidDuplicatePurchases v1 の配布と利用条件を表す用語を定義するコンテキスト。

## Language

**公式配布経路**:
GitHub Release の assets を、AvoidDuplicatePurchases v1 の利用者へ渡す正式な経路とする。
_Avoid_: Marketplace 公開、production 配布

**Release**:
SemVer tag に固定された、検証済みの配布bundleとその証跡を公開した単位。
_Avoid_: deployment、Marketplace listing

**配布bundle**:
sourceを含まず、extensionとローカルserverを利用者が導入・起動するために必要な実行用ファイルをまとめたもの。
_Avoid_: source package

**Release candidate**:
exact tagから生成され、検証は済んでいるが、人の承認前でまだ公開されていない配布bundle。
_Avoid_: draft release、production build

**dry-run**:
exact tagからRelease candidateを生成・検証するが、GitHub Releaseを公開しない手動検証実行。
_Avoid_: Release公開、production deploy

**Release notes**:
GitHub Releaseに添付する、version・tag・commit・checksum・検証結果・対応環境・未対応範囲・既知の制約を示す最小説明。
_Avoid_: log dump

**version**:
公式Releaseのexactな `vMAJOR.MINOR.PATCH` tag が表す安定版SemVer値。extension manifestとRelease metadataはこの値に一致し、workspace package versionはversionの一部ではない。
_Avoid_: package version（内部パッケージの版だけを指す場合）

**対応環境**:
Google Chrome DesktopのMV3 extensionと、localhostで動作するNode.js 22.x serverの組み合わせ。対応ブラウザは検証済みのGoogle Chrome Desktopに限定する。
_Avoid_: production environment、対応Marketplace

**未検証ブラウザ**:
EdgeなどのChromium派生ブラウザ。対応ブラウザとは呼ばず、個別の検証が済むまで未検証として扱う。

**Release証跡**:
配布bundleのSHA-256、tag/commit/version情報、検証結果を再確認できる付属情報。
_Avoid_: log dump
