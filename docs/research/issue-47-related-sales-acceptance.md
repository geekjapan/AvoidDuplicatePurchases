# Issue #47: related products / sales comparison acceptance (2026-08-09)

Status: synthetic-fixture contract fixed on branch
`geekjapan/feature-47-related-sales-20260809` against base
`3c1c76ff7d47bb0981f869e1e79d05d587bb6c5e` (#42 + #45 merge).

Canonical scope: GitHub Issue #47 body redefined 2026-08-09. This note records
what was implemented and verified; it does not invent store provider payloads
or expand Amazon / ebookjapan / Kobo (#43/#44/#46).

## In scope (accepted)

| Area | Contract | Evidence |
|---|---|---|
| Shared schemas | Relation evidence limited to `maker` / `author` / `series` / `store_related`; `Money` reuses #45 `taxStatus`; market offer price keeps currency/tax/observedAt/freshness | `shared/src/api.ts`, `shared/test/related-products.test.ts` |
| Persistence | `related_edge` + `market_offer`; never writes unowned candidates into `listing` | `server/migrations/005_related_sales.sql` |
| Import boundary | `POST /api/import/related` accepts **only** `contract: "synthetic_related_v1"` normalized items. Raw store payloads are rejected | `server/src/routes/related-products.ts`, `server/test/related-products.test.ts` |
| Read API | `GET /api/related-products` with anchor source+cid, `owned=exclude\|mark`, sort/filter/paging | same |
| Ownership | `owned` via canonical `(source,cid)` (`normalizeCid` on import product cid before owned/self guards and market_offer writes); `possible_duplicate` via exact title+maker (lookup rule); default exclude | `server/src/services/related-products.ts` |
| Price snapshot | `current` / `regular` nullable Money; `discountPercent` only explicit or same currency+taxStatus derivation; `saleEndsAt` only when explicit; freshness `fresh`/`stale`/`unavailable` (24h TTL) | helpers + tests |
| Admin UI | Separate「関連比較」page; owned anchor card never mixed into related table; sale/stale/null display | `admin/src/pages/related.ts`, `admin/test/related-display.test.ts` |
| #42/#45 integration | Existing listings + priceObservation surfaces unchanged | server test still hits `GET /api/listings` |

## Synthetic fixture matrix

Fixture: `server/test/fixtures/related-products-synthetic.json`

| product cid | evidence | price case |
|---|---|---|
| `RJ900101` | maker (derived) | normal sale: current+regular+explicit discount+saleEndsAt |
| `d_rel_sale_1` | store_related (store) | sale without explicit discount (derived 50%) |
| `b_rel_stale_1` | series + author | stale observation (TTL > 24h), no invented saleEndsAt |
| `RJ900404` | maker | null/unavailable price |

## Explicit non-goals / residual human gates

1. **Real provider relation payload/API** — DLsite / FANZA 同人 / FANZA ブックスの related-products 取得経路・raw schema・pagination・Cookie 条件は未検証。本実装は synthetic_related_v1 のみ。store adapter 調査後に `POST /api/import/:source/related` の raw parse を追加する人間ゲート。
2. **Network fetch from extension** — 拡張が user session で related payload を取る経路は未実装（発明禁止）。
3. **Derived edge auto-scan of whole catalog** — import された evidence のみ。全 listing からの maker 全件走査はしない。
4. **#43/#44/#46** — Amazon / ebookjapan / 楽天Kobo は対象外。
5. **Title-similarity relations** — 禁止のまま。
6. **Cart / purchase / coupon / credentials / private API / background crawl** — 禁止のまま。
7. Push / PR / merge / Issue close は worker 権限外。

## Money / freshness alignment with #45

- Reuse `MoneySchema` (`amountMinor`, `currency`, `taxStatus`) — no parallel `tax` field.
- Market offer freshness is independent of owned-listing `priceObservation` tiers.
- `observedAt` is server receipt time for the related import snapshot.
- Stale keeps last-known amounts + observedAt; unavailable nulls price amounts.

## Verification commands (worker)

```text
git rev-parse HEAD
git status --porcelain --untracked-files=all
git diff --check 3c1c76ff7d47bb0981f869e1e79d05d587bb6c5e
npm ci || npm install
npm test -w shared
npm test -w server
npm test -w admin
npm run build -w shared && npm run build -w server && npm run build -w admin
npm run lint
```

## Requirement coverage checklist (R)

| Id | Requirement | Evidence |
|---|---|---|
| R-relation | maker/author/series/store_related only | schema + tests reject title_similarity |
| R-separate | owned listing ≠ market offer | import rejects owned cid; listing count unchanged |
| R-price | currency/tax/observedAt/stale/null | freshness helpers + display |
| R-no-invent | no invented sale end / discount without evidence | stale item asserts null saleEndsAt/discount |
| R-owned-ui | exclude or mark | service owned modes + admin ownership column |
| R-fixture | synthetic fixtures cover matrix | related-products-synthetic.json |
| R-scope | no #43/#44/#46 | sources stay in existing SOURCES only |
