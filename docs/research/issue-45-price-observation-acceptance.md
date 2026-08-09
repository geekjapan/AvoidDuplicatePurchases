# Issue #45: price observation acceptance (2026-08-09)

Status: acceptance complete on branch `geekjapan/feature-45-price-observation-20260809` against base `084c7eb7cc1f5dc2e0be273667973d2bcc3bb8cd` (PR #54 / #42 merge + PR #53 foundations).

Canonical scope: GitHub Issue #45 body redefined 2026-08-09. This note records what was verified; it does not expand store scope.

## In scope (accepted)

| Area | Contract | Evidence |
|---|---|---|
| Visible three-tier observation | DLsite / FANZA Doujin / FANZA Books product pages: `regular` / `sale` / `coupon` independent tiers with `amountMinor` + `currency=JPY` + `taxStatus` only when visible evidence exists | `extension/src/content/price-observation.ts`, synthetic fixtures in `extension/src/content/test/price-observation.test.ts` |
| Persistence | Owned listing only; `price_observation` table; server stamps `observedAt` (UTC receipt); never creates listings | `server/src/services/price-observation.ts`, `server/migrations/004_price_observations.sql` |
| Listings API surface | `GET /api/listings` returns `priceObservation` (or `null`); `purchasePrice` / `currentPrice` always `null` without high-trust primary evidence | `server/src/routes/listings.ts`, `server/test/price-observation.test.ts` |
| Admin display | Three-tier labels + `未取得` for null tiers; observation time shown when present | `admin/src/pages/library.ts`, `admin/test/library-display.test.ts` |
| Search / filter / sort | Price parameters consult **only** stored `priceObservation` values | See query contract below |
| Fail-closed | Invalid currency/tax/time/page URL rejected; missing tiers stay null; no FX, no tax invention, no coupon apply/cart/purchase | shared Zod schemas + server/extension tests |

## Query contract (`GET /api/listings`)

| Param | Meaning |
|---|---|
| `q` / `source` / `maker` | Existing text filters (unchanged) |
| `priceCurrency` | Exact ISO 4217 match against a **stored observation tier** currency. Rows without a matching observation do not match. Never reads `purchasePrice` / `currentPrice`. |
| `priceTier` | `regular` \| `sale` \| `coupon`. With `priceCurrency`, restricts the currency match to that tier. Required for price sorts. |
| `sort` | `work` (default), `title_asc`, `title_desc`, `purchased_at_asc`, `purchased_at_desc`, `price_observation_asc`, `price_observation_desc`. |
| `limit` / `offset` | Existing paging |

Rules:

1. `price_observation_*` requires both `priceCurrency` and `priceTier` (schema + server 400). Prevents cross-currency ordering and invented "effective" prices.
2. Missing observation amounts sort **last**, never as `0`.
3. Ties break on `(workId, id)`.
4. `current_price_*` / `purchase_price_*` sort keys are **not** accepted.
5. Admin UI mirrors the same parameters; client-side guard mirrors the server requirement for price sorts.

## Explicit non-goals (still out of scope)

- #43 Amazon, #44 ebookjapan, #46 Rakuten Kobo as priceObservation sources
- #47 related products / sales comparison
- Populating `purchasePrice` or `currentPrice` from visible DOM, FX, or tax inference
- Credentials, cookies, localStorage, private APIs, background crawl, cart/coupon mutation
- Push / PR / merge / Issue close from this worker

## Residual gates (human / later issues)

1. Authorized purchase-record source for non-null `purchasePrice`
2. Authorized product-metadata source for non-null `currentPrice`
3. Whether additional currencies beyond JPY ever appear in visible-DOM tiers for current sources
4. #47 may consume the same `priceObservation` snapshot + null/stale boundary; not implemented here

## Verification commands (worker)

```text
git rev-parse HEAD
git status --porcelain --untracked-files=all
git diff --check 084c7eb7cc1f5dc2e0be273667973d2bcc3bb8cd
npm ci || npm install
npm test -w shared
npm test -w server
npm test -w admin
npm test -w extension -- --test-name-pattern price
npm run build -w shared && npm run build -w server && npm run build -w admin
npm run lint
```
