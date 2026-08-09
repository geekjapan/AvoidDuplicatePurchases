# Issue #42: current-store owned library acceptance

Status: acceptance fixed for the five adapter sources on the listing/work
display contract. This note is the Issue #42 (redefined 2026-08-09) evidence
boundary for dlsite / fanza_doujin / fanza_books / fanza_video / fanza_dlsoft.
It does not expand Amazon / ebookjapan / Kobo (#43/#44/#46), purchasePrice /
currentPrice population (#45), or related-product comparison (#47).

## Goal locked by this acceptance

User-initiated sync results for the **current five stores** are stored as
local `listing` rows (ownership) linked to `work` (grouping only), exposed
through a **flat** `GET /api/listings`, and rendered in the admin library page
with the same nullable display contract.

Display fields under test:

| Field | Contract |
|---|---|
| title | Required non-empty listing title |
| maker | Nullable author/circle/brand |
| source + cid | Store identity; admin shows `source / cid` |
| purchasedAt + purchasedAtPrecision | Ownership event time; `unknown` forces `purchasedAt: null` (never `imported_at`) |
| imageUrl + imageProvenance | Absolute http(s) only when the source has an approved image provenance |
| productUrl + productUrlProvenance | HTTPS verified_derived (or null when evidence is incomplete) |
| purchasePrice / currentPrice | Always `null` until an authorized price source exists (#45) |
| priceObservation | Optional existing display only; not extended by #42 |

Missing values render as **未取得** in the admin UI. Null money is not `0`.
Null dates are not import timestamps. The admin groups by `workId` without
inventing work-level title / image / price aggregates.

## Synthetic fixture matrix (five current sources)

Fixtures are synthetic / redacted only. No credentials, cookies,
localStorage, private APIs, background crawl, cart/purchase/coupon mutation,
or real personal purchase data.

| source | fixture | image | purchase date | product link | notes |
|---|---|---|---|---|---|
| dlsite | `server/test/fixtures/dlsite-sales.json` + `dlsite-product-rj000001.json` | product metadata URL + `store_product_metadata` for RJ000001; null for RJ000002 without product metadata | second precision from sales | verified_derived maniax work URL | RJ000002 title falls back to cid; maker null |
| fanza_doujin | `shared/test/fixtures/fanza-doujin-page.json` | library `imageSrc` + `store_library_metadata` when non-empty | day precision; broken day label → null date | verified_derived doujin detail URL | empty imageSrc → null image |
| fanza_books | `shared/test/fixtures/fanza-books-import.json` | no approved image provenance → null | second precision purchase timestamp | verified_derived book product URL (requires seriesId) | unverified image URLs suppressed |
| fanza_video | `shared/test/fixtures/fanza-video-page.json` | no image contract → null | unknown / null (viewing-rights time is not purchase) | verified_derived only with floor evidence | incomplete floor → null product URL |
| fanza_dlsoft | `shared/test/fixtures/fanza-dlsoft-page.json` | package image + `store_library_metadata` | unknown / null | verified_derived dlsoft detail URL | delivery date is not purchase |

## Regression tests

| Layer | File | What it pins |
|---|---|---|
| shared schema | `shared/test/api.test.ts` | `ListingSchema` null co-presence, strict keys, HTTPS product URL, Money/CurrentPrice/PriceObservation shapes |
| shared adapters | `shared/test/fanza-adapters.test.ts`, `shared/test/dlsite-adapter.test.ts` | per-source parse boundaries for date/image and `productUrlForSource` evidence |
| server API | `server/test/listings-display.test.ts` | five-source display matrix, unknown-precision nulling, incomplete video floor, flat pagination, no work aggregates |
| admin UI | `admin/test/library-display.test.ts` | image/lazy/no-referrer, day/second/unknown dates, safe product links, 未取得 placeholders, five-source work grouping without work-level title inventing |
| admin async | `admin/test/library-async.test.ts` | load/pending discipline on the same listings endpoint |

## Safety boundary (must hold)

- Inputs are user-initiated or fixture-permitted only.
- No credentials, cookies, localStorage scrape, private APIs, background crawl.
- No cart / purchase / coupon mutation.
- Product links open with `rel="noreferrer noopener"`; images use
  `loading="lazy"` and `referrerpolicy="no-referrer"`.
- Library dataset stays local (`127.0.0.1`); no third-party library upload.

## Out of scope (human / later issues)

- #43 Amazon, #44 ebookjapan, #46 Rakuten Kobo target-store addition.
- #45 three-tier `priceObservation` completion and purchasePrice/currentPrice
  population (leave existing null/display behavior as-is).
- #47 related products / market offers / comparison UI.
- Issue close, push, PR, merge (lifecycle remains with coordinator/human).

## Requirement coverage checklist (R)

| Id | Requirement | Evidence |
|---|---|---|
| R-image | Image URL only with approved provenance; missing → null / 未取得 | `listings-display` matrix + admin display tests |
| R-date | purchasedAt + precision; unknown never leaks import time | server nulling test + adapter fixtures |
| R-link | Verified HTTPS product URL or null (no store-root guess) | incomplete video floor + books seriesId gate |
| R-null | Explicit null / 未取得 for missing maker/image/date/link/price | admin five-source UI test |
| R-flat | GET /api/listings flat + paginated; admin groups by workId only | pagination test + work-group header count-only |
| R-price-leave | purchasePrice/currentPrice stay null; no invented tax/FX | listings matrix asserts null prices |
| R-scope | Only five current adapter sources for this acceptance | fixtures/tests use those sources only |
