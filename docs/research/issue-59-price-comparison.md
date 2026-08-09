# Issue #59: FANZA / DLsite 保有作品価格比較

Status: admin read-only comparison UI implemented on branch
`geekjapan/feature-59-price-comparison-fanza-dlsite-20260809` against base
`099ef5aae3d0f861ae1bffa6c88137747e034710` (origin/main).

Canonical scope: GitHub Issue #59. This note records the manual-sync /
read-only data boundary and comparison limitations. It does not invent
provider APIs, credentials, or real personal purchase data.

Related: [#45 priceObservation](./issue-45-library-contract.md),
[#47 related products](./issue-47-related-sales-acceptance.md).

## In scope (accepted)

| Area | Contract | Evidence |
|---|---|---|
| Input | Persisted `Listing.priceObservation` only, via existing `GET /api/listings` | `admin/src/pages/price-comparison.ts`, `admin/src/api.ts` `fetchListings` |
| Scope | Exactly `dlsite`, `fanza_doujin`, `fanza_books` | `PRICE_COMPARISON_SOURCES` + filter tests |
| Grouping | Existing `workId` only; no title matching; no fabricated multi-listing price | `groupByWorkId` + display test |
| Identity | Brand label may say FANZA / DLsite; `source` + `cid` remain visible | UI identity column |
| Tiers | Independent `regular` / `sale` / `coupon`; null → `未取得`; no cross-tier fill | display + pure tests |
| Meta | Show `observedAt`, currency, `taxStatus` (via Money display) | listing row + summaries |
| Ranking | Lowest only when ≥2 non-null values share currency **and** taxStatus | `compareTier` |
| Fail-closed | Currency or taxStatus mismatch → `比較不可`; never rank or subtract | pure + display tests |
| Exclusions | `fanza_video`, `fanza_dlsoft`, Amazon, ebookjapan, Kobo, others | filter + display test |
| Schema | No change to shared `PriceObservationSchema` or #47 related-products contract | no `shared/` edits |
| UI surface | Discoverable admin nav「価格比較」`/price-comparison`; library / related unchanged | `router.ts`, `main.ts` |

## Data boundary (manual sync / read-only)

1. **No provider fetcher** — This view never calls store APIs, private endpoints, or product pages.
2. **No credentials** — No Cookie, localStorage, extension session, or account identifier access.
3. **No background crawl** — No polling or scheduled re-observation from the admin SPA.
4. **No purchase / cart / coupon mutation** — Display eligibility only; coupon tier is not a payment amount.
5. **Observations arrive elsewhere** — Visible-DOM observations are written by the existing extension → `POST` price-observation path (#45). This page only **reads** what is already stored on owned listings.
6. **No real personal data in fixtures** — Acceptance uses synthetic listings only.

## Comparison limitations

- `workId` is an **internal grouping key** and may change after rematch. It is not a durable public work identity.
- A work group has **no canonical title or aggregate price**. Each listing row keeps its own observation.
- **Title similarity does not merge works** for comparison. Same title under different `workId`s stays separate.
- **Currency conversion is forbidden.** Mismatched currency → `比較不可`.
- **Tax inference is forbidden.** `included` vs `excluded` vs `unknown` must not be ranked together.
- **Tier independence:** a null `sale` is not filled from `regular` or a percentage.
- **Single-value tiers** are shown on the row but the cross-store summary is `比較対象不足` (fewer than two non-null values).
- **Excluded sources** may still exist in the library; they are omitted from this view only.
- **Stale / missing observations** are shown as stored (or all-`未取得` when `priceObservation` is null). This page does not implement #47 freshness labels.

## Relation to #45 / #47

| Concern | #45 library | #47 related | #59 this issue |
|---|---|---|---|
| Entity | Owned listing | Market offer (not owned library row) | Owned listing |
| Price shape | `priceObservation` three tiers | Related price snapshot + freshness | Reuse #45 tiers only |
| Grouping | workId in library | Anchor source+cid + relation evidence | workId among #59 sources |
| Fetch | Manual / extension observation | Synthetic related import contract | Read listings API only |

#47 remains a separate route（関連比較）. This issue must not weaken that surface or the library priceObservation display.

## Synthetic fixture coverage (admin tests)

| Case | Test |
|---|---|
| Same work FANZA + DLsite three-tier + observedAt | `price-comparison-display.test.ts` |
| Missing tier → 未取得 | same |
| Excluded `fanza_video` / `fanza_dlsoft` | same |
| Lowest among matching currency+tax | pure + display |
| Tax / currency mismatch → 比較不可 | pure + display |
| Different workId same title not merged | display |
| Filter source allow-list | `price-comparison.test.ts` |

## Explicit non-goals / residual human gates

1. Live store price re-fetch or private product APIs.
2. Amazon / ebookjapan / 楽天 Kobo (#43 / #44 / #46).
3. Currency conversion or tax-rate application.
4. Title-based work matching for price aggregation.
5. Changing shared persistence schema of `price_observation`.
6. Push / PR / merge / Issue close (worker authority boundary).

## Verification commands (worker)

```text
git rev-parse HEAD
git status --porcelain --untracked-files=all
git diff --check 099ef5aae3d0f861ae1bffa6c88137747e034710
npm test -w admin
npm run build -w admin
npm run lint
```

## Requirement coverage checklist (R)

| Id | Requirement | Evidence |
|---|---|---|
| R-scope | dlsite / fanza_doujin / fanza_books only | filter + display |
| R-workId | group by existing workId only | groupByWorkId + display |
| R-tiers | regular / sale / coupon independent + 未取得 | display |
| R-meta | observedAt / currency / taxStatus | moneyLabel + row |
| R-fail-closed | mismatch → 比較不可, no rank | compareTier |
| R-readonly | no provider / creds / crawl / cart | page boundary copy + no new API |
| R-no-schema | shared priceObservation unchanged | git diff scope |
| R-nav | discoverable without removing library/related | router + main |
| R-test | synthetic admin tests | admin/test/price-comparison*.test.ts |
| R-doc | boundary + limitations | this file |
