# AGENTS.md

## 応答言語

ユーザーへの説明・質問・報告は、ユーザーが別の言語を指定しない限り日本語で行う。コード、識別子、コマンド、引用する原文は原文のまま保持する。

## Agent skills

### Issue tracker

GitHub Issues(`gh` CLI)で管理する。詳細は `docs/agents/issue-tracker.md` を参照。

### Triage labels

デフォルトの5ラベル(`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`)をそのまま使用。詳細は `docs/agents/triage-labels.md` を参照。

### Domain docs

single-context(リポジトリルート直下に `CONTEXT.md` + `docs/adr/`)。詳細は `docs/agents/domain.md` を参照。
