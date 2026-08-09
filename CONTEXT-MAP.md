# Context Map

## Contexts

- [Release Distribution](./CONTEXT.md) — v1 の公式配布経路、Release、配布bundle、対応環境などの用語
- [Duplicate Purchase Prevention](./docs/domain/duplicate-purchase-prevention/CONTEXT.md) — 保有判定に基づく購入前介入と購入進行ブロックの用語

## Relationships

- **Duplicate Purchase Prevention → Release Distribution**: 介入機能は対応環境（Chrome Desktop MV3 extension + localhost server）上で動く前提。配布の版や経路は Release Distribution が定義する。
- 両 context はデータ所有を共有しない。購入履歴・照合・介入 UI は Duplicate Purchase Prevention 側の関心。
