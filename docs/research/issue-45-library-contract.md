# Issue #45: library display contract

Status: design-only. This note defines the smallest contract that can be implemented without inventing store data. It does not change the application, the issue tracker, or the current store scope.

Source issues: [#45](https://github.com/geekjapan/AvoidDuplicatePurchases/issues/45), [#43 Amazon/Kindle](https://github.com/geekjapan/AvoidDuplicatePurchases/issues/43), [#44 ebookjapan](https://github.com/geekjapan/AvoidDuplicatePurchases/issues/44), [#46 Rakuten Kobo](https://github.com/geekjapan/AvoidDuplicatePurchases/issues/46).

## What already exists

- The approved model is `work` (currently only `id`), `listing` (one store-specific owned product), and derived `match_key`. Listing ownership is represented by the row; `(source, cid)` is the stable external identity and `work.id` may change after rematch. [`docs/spec.md`](../../docs/spec.md#L43-L88), [`server/migrations/001_initial.sql`](../../server/migrations/001_initial.sql#L1-L35)
- The five existing source values are `dlsite`, `fanza_doujin`, `fanza_books`, `fanza_video`, and `fanza_dlsoft`. [`shared/src/identity.ts`](../../shared/src/identity.ts#L1-L15)
- `listing` already stores `title`, `maker_name`, `series_id`, `image_url`, `purchased_at`, `purchased_at_precision`, `raw_json`, and `imported_at`. There are no purchase-price, current-price, currency, tax, price-observation, or product-URL columns. [`server/migrations/001_initial.sql`](../../server/migrations/001_initial.sql#L5-L25)
- `GET /api/listings` currently returns a flat, paginated `listings` array with `id`, source/cid, `workId`, lock state, title, maker, series ID, image URL, and purchase timestamp. Its query is `q`, `source`, `maker`, `limit`, and `offset`; server order is `work_id, id`. [`shared/src/api.ts`](../../shared/src/api.ts#L126-L152), [`server/src/routes/listings.ts`](../../server/src/routes/listings.ts#L31-L117)
- The admin page already groups that flat array by `workId`, then renders one row per listing with merge/split actions. It currently searches title/maker/source through the existing endpoint and does not render image, URL, purchase date, or price fields. [`admin/src/pages/library.ts`](../../admin/src/pages/library.ts#L25-L33), [`admin/src/pages/library.ts`](../../admin/src/pages/library.ts#L148-L185), [`admin/src/pages/library.ts`](../../admin/src/pages/library.ts#L228-L299)
- Product URL builders already exist. They produce verified derived URLs from source identity, with `series_id` required for Books and an evidence-backed floor required for Video; lookup returns such URLs only for its `other` results, not for library listings. Missing evidence returns no URL rather than a store-root or guessed URL. [`shared/adapters/dlsite/urls.ts`](../../shared/adapters/dlsite/urls.ts#L37-L129), [`server/src/services/lookup.ts`](../../server/src/services/lookup.ts#L104-L153)
- Current image and purchase-date provenance is adapter-specific: DLsite gets image metadata from `product.json` and second-precision sales time; FANZA Doujin gets `imageSrc` and a day-precision library date; FANZA Books currently has no image but has a purchased timestamp; FANZA Video deliberately has no image or purchase timestamp; FANZA dlsoft gets `packageImageUrl` but deliberately has no purchase timestamp. [`shared/adapters/dlsite/parse-sales.ts`](../../shared/adapters/dlsite/parse-sales.ts#L116-L169), [`shared/adapters/fanza_doujin/parse.ts`](../../shared/adapters/fanza_doujin/parse.ts#L56-L89), [`shared/adapters/fanza_books/parse.ts`](../../shared/adapters/fanza_books/parse.ts#L148-L176), [`shared/adapters/fanza_video/parse.ts`](../../shared/adapters/fanza_video/parse.ts#L50-L68), [`shared/adapters/fanza_dlsoft/parse.ts`](../../shared/adapters/fanza_dlsoft/parse.ts#L34-L59)
- The repository's `CONTEXT.md` contains release-distribution vocabulary, not library-domain decisions; the library terms therefore continue to come from the approved spec. [`CONTEXT.md`](../../CONTEXT.md#L1-L44)

## Minimal API/data contract

Keep `GET /api/listings`; do not add a second library endpoint. Keep the response flat so the existing paging and merge/split paths remain reusable. `total` counts listing rows, not work groups. The admin client fetches all pages before grouping, as it already does. [`admin/src/api.ts`](../../admin/src/api.ts#L36-L73)

Extend each returned listing to this shape. Existing fields keep their names; nullable display fields are returned explicitly as `null`, never as empty strings or omitted fields.

```ts
type Money = {
  amountMinor: number; // integer >= 0; zero is valid only when the store reports zero
  currency: string; // uppercase ISO 4217 code, e.g. "JPY"
  taxStatus: "included" | "excluded" | "unknown";
};

type CurrentPrice = Money & {
  observedAt: string; // UTC ISO-8601 instant when ADP obtained this observation
  provenance: "store_product_metadata" | "store_library_metadata";
};

type LibraryListing = {
  id: number;
  source: Source;
  cid: string;
  workId: number; // grouping key only; not a stable public work identity
  workIdLocked: boolean;
  title: string;
  maker: string | null;
  seriesId: string | null;

  imageUrl: string | null;
  imageProvenance: "store_product_metadata" | "store_library_metadata" | null;
  productUrl: string | null;
  productUrlProvenance: "store_canonical" | "verified_derived" | null;

  purchasedAt: string | null;
  purchasedAtPrecision: "second" | "day" | "unknown";
  purchasePrice: Money | null;
  currentPrice: CurrentPrice | null;
};
```

Field rules:

| Field | Contract |
|---|---|
| `imageUrl` | Use only a validated absolute `http`/`https` URL from store metadata. `imageProvenance` says whether the value came from product metadata or the owned-library payload. Do not derive an image URL from a cid. |
| `productUrl` | Use an explicitly verified canonical store URL or an adapter's verified derivation from `(source, cid)` plus required evidence. `productUrlProvenance` must match. If the builder lacks required evidence, return `null`; never guess, use a store root, or use a search URL. |
| `purchasedAt` | The store's ownership/acquisition event time, not `imported_at` and not the current-price fetch time. `second` accepts an ISO-8601 instant; `day` accepts the source date at day precision; `unknown` is used when no trustworthy event time exists. |
| `purchasePrice` | The amount actually supplied by a purchase record. Do not infer it from a current price, list price, sale badge, or `0`. `amountMinor` and `currency` are both present when the value exists. |
| `currentPrice` | The latest separately acquired store price snapshot. `observedAt` is the ADP observation time, stored in UTC; it is not a claim about when the store changed the price. Keep only the latest snapshot in v1; no price-history UI. |
| `currency` | ISO 4217 code, no FX conversion. JPY/USD/etc. values remain separate. Never add or compare amounts across currencies. |
| `taxStatus` | Preserve the store's stated tax treatment: included, excluded, or unknown. Do not apply a tax rate, infer tax status from locale, or silently round/recalculate. |

The corresponding persistence change, when implementation is authorized, is limited to provenance/URL and normalized price fields on `listing`: image provenance, product URL and provenance, purchase amount/currency/tax status, current amount/currency/tax status, current-price observed time, and current-price provenance. Existing `image_url`, `purchased_at`, and `purchased_at_precision` remain the source fields. `raw_json` remains evidence, not a display contract.

## Work/listing grouping and UI

- Fetch the flat listing response, apply the server filters/sort, then group rows by `workId`.
- Render one work group per `workId`; render one store-specific listing row/card inside it. A work group has no canonical title, image, price, currency, or purchase date because `work` has no attributes. Do not select a representative listing or aggregate values.
- Each listing row shows, in this order: thumbnail/title/maker, source and cid, purchase date, purchase price, current price with its observation time, and the product link. Merge/split continues to address the listing's `(source, cid)` and remains separate from display data.
- `workId` is an internal grouping key and must not be presented as a durable external identifier. A rematch can change it. The group header may show only a count (for example, `作品グループ — 2 listings`).
- An image has `alt=title`, lazy loading, and a placeholder when `imageUrl` is null or fails to load. A missing product URL is text `未取得`, not a disabled guessed link.
- Missing text, date, image, URL, or price renders as `未取得`. A null price is not `0`; a null date is not `imported_at`. For a day-precision date, show a date only; for a second-precision instant, show the user's local date/time while retaining the UTC value in the API.
- A price displays the store currency and tax status when known. The UI does not display a total for a work group and does not convert currencies.

## Search, filters, and sort

Extend the existing query without changing its current meanings:

| Query | Meaning |
|---|---|
| `q` | Case-insensitive substring over title, maker, source, and cid. Blank means no text filter. |
| `source` | Exact match against the existing `Source` enum. |
| `maker` | Existing normalized exact-maker filter. |
| `priceCurrency` | Optional exact current-price currency filter. Rows without a current price do not match. |
| `sort` | `work` (default), `title_asc`, `title_desc`, `purchased_at_asc`, `purchased_at_desc`, `current_price_asc`, or `current_price_desc`. |
| `limit` / `offset` | Existing positive limit (maximum 500) and non-negative offset. |

`current_price_*` requires `priceCurrency`; this is the only supported price sort and prevents cross-currency ordering. Missing values sort last. All ties use `(workId, id)` for deterministic output. `sort=work` preserves the existing `work_id ASC, id ASC` order. `total` remains the number of filtered listings, so the UI can distinguish listing count from work-group count.

## Privacy boundary

- Purchase dates, purchase prices, current prices, and raw evidence are local-library data. They are returned only by the local admin listing endpoint; do not add them to extension page lookup responses or any outbound store request.
- Keep the existing local boundary: the server binds to `127.0.0.1`, checks local/registered extension origins, and permits `/api/listings` in read-only mode. [`docs/spec.md`](../../docs/spec.md#L146-L167), [`server/src/config.ts`](../../server/src/config.ts#L1-L56), [`server/src/middleware/readonly-guard.ts`](../../server/src/middleware/readonly-guard.ts#L10-L64)
- Do not expose `raw_json`, `imported_at`, cookies, account identifiers, order/receipt identifiers, or adapter payloads in `ListingSchema`. Existing responses already select normalized listing columns rather than raw evidence. [`server/src/routes/listings.ts`](../../server/src/routes/listings.ts#L31-L56)
- Do not proxy images or send the library/search query to a third party. If the browser renders a remote image, use `loading="lazy"` and `referrerpolicy="no-referrer"`; product links open with `rel="noreferrer noopener"`. A product link or image request is an individual user action/resource fetch, not a transfer of the library dataset.
- Preserve the existing rule that purchase data stays in local SQLite and the configured sync folder, with no telemetry or cloud library service. [`docs/spec.md`](../../docs/spec.md#L178-L197)

## Store-data gate and unresolved decisions

The contract can be added to the existing five-source library with null prices until source-specific evidence exists. It must not fabricate values from `raw_json` or from a current product page.

The following decisions remain intentionally unresolved and require user/store-research input before enabling corresponding data:

1. **Price source and timing:** which authorized endpoint/page supplies `purchasePrice` and `currentPrice` for each existing source, and whether current-price refresh is manual, sync-triggered, or scheduled. Until answered, both price objects are `null`.
2. **Purchase amount semantics:** whether a store's record exposes final paid amount, pre-discount amount, coupon allocation, or only a displayed list price. Only a value explicitly identified by the store as the applicable purchase amount may populate `purchasePrice`.
3. **Tax/currency evidence:** the store/region/account context for each amount and whether the source marks tax included/excluded. No locale-based tax inference or FX conversion is authorized.
4. **Scope of #43/#44/#46:** whether Amazon/Kindle, ebookjapan, and Rakuten Kobo are enabled in this library contract at all, and which regions/content types count as owned. Those issues still require a legal/authorized acquisition path, ownership-state distinction, stable product identity, and real source payloads; their triage notes explicitly say the current five-source implementation does not include them. [#43](https://github.com/geekjapan/AvoidDuplicatePurchases/issues/43), [#44](https://github.com/geekjapan/AvoidDuplicatePurchases/issues/44), [#46](https://github.com/geekjapan/AvoidDuplicatePurchases/issues/46)
5. **Canonical URL/image availability for new stores:** the adapter must provide a verified canonical URL or a derivation recipe and a real image provenance before those fields are non-null. A missing value remains `未取得`.

Until those decisions land, #45 is a display-contract task only: implement the existing grouping and normalized nullable fields first; keep price fields and unsupported-store values absent/null rather than guessing.
