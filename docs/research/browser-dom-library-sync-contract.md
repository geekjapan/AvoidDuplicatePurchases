# Browser DOM library-sync foundation contract (#43 / #44 / #46)

Status: implemented (foundation). This note is the typed contract that the three
provider reader tasks (Amazon Kindle, ebookjapan, Rakuten Kobo) implement
against. The foundation itself ships **no provider DOM selectors, no
ownership mapping, and no price values**; those are later provider-task
concerns.

Source issues: [#43 Amazon/Kindle](https://github.com/geekjapan/AvoidDuplicatePurchases/issues/43),
[#44 ebookjapan](https://github.com/geekjapan/AvoidDuplicatePurchases/issues/44),
[#46 Rakuten Kobo](https://github.com/geekjapan/AvoidDuplicatePurchases/issues/46),
and the human scope delta of 2026-08-08
(`.orca/workflows/dom-sync-20260808/decisions/browser-dom-and-price-scope.md`):
user-initiated navigation to each provider's signed-in library page, visible
DOM reads only, automatic visible next-page following with a bounded visited
loop, no private-network/API/cookie/localStorage access, no destructive or
library-mutation clicks, and Amazon/ebookjapan/Kobo price fields stay
null/未取得.

## What the foundation adds

### Identity and schemas (`shared/src/identity.ts`, `shared/src/api.ts`)

- `SOURCES` grows with `amazon`, `ebookjapan`, `kobo`, so `SourceSchema` and
  the listing `CHECK` accept the three library sources.
- `LIBRARY_SOURCES = ["amazon", "ebookjapan", "kobo"]` with
  `LibrarySourceSchema` — the disjoint namespace of the DOM library-sync
  protocol (the legacy five adapter sources are not part of it).
- `LIBRARY_ITEM_STATES = ["purchased","free","rental","sample","preview","subscription","gift","reservation","unknown"]`
  with `LibraryItemStateSchema`. Every state is explicit and passes through
  verbatim; nothing is inferred from a title or price. `unknown` is a first
  class value — a reader that cannot classify an item must emit `unknown`,
  never a guessed ownership.
- `LIBRARY_SYNC_PROVIDERS` registers the start URLs; `librarySyncProvider(source)`
  resolves them. amazon is the URL confirmed by research #43; the
  ebookjapan bookshelf and Kobo my-library entries are the canonical pages
  and are re-confirmed by the provider reader tasks (single place to update).
- `LibraryImportItemSchema` (strict) carries `cid`, `title`, `state` and
  optional `maker`, `seriesId`, `imageUrl`, `productUrl` only. **No price
  fields exist**; a strict schema rejects any extra key, so the price
  boundary is enforced at compile time and at the API boundary.

### Database (`server/migrations/003_library_sync_sources.sql`)

- `listing` is rebuilt with the extended source `CHECK` (SQLite cannot alter
  a CHECK constraint); data, indexes, and `UNIQUE (source, cid)` are
  preserved, so existing `upsert` semantics are unchanged and idempotent.
- New `library_observation` table (PK `(source, cid)`): one row per DOM
  observation with the explicit `state`, identity fields, `page_url`,
  `raw_json`, and `observed_at`. Import is upsert-only — the latest
  observation wins, rows are never deleted. The schema/foundation layer
  **persists every explicit state on `library_observation`**; it does not
  invent ownership from titles or prices. `state` has its own CHECK
  mirroring the shared vocabulary.

### Server (`server/src/routes/library.ts`, `server/src/http.ts`, `server/src/import/library/index.ts`)

- `POST /api/import/library` — body is `LibraryImportRequestSchema`
  (`.strict()`): `source` (library source), `pageUrl` (absolute https and
  canonical for the source — `isCanonicalLibraryPageUrl` accepts the amazon
  `booksAll` path with an optional positive `pageNumber`, the ebookjapan
  `/bookshelf` path with an optional positive `page`, and the Kobo
  `/e-book/kobo/library[/page/N]` path with **no query/hash**), `items`
  (1..100, bounded batch). Response is `LibraryImportResponseSchema`
  (`.strict()`): `observed` / `inserted` / `updated` plus per-state counts
  emitted for **every** vocabulary state key (`byState` is full-key strict,
  missing or unknown keys fail closed). The batch is imported atomically and
  idempotently.
- **Layer split (current implementation):** the content/background foundation
  only records explicit observations. The **server import layer** maps
  `state === "purchased"` observations onto the existing idempotent `listing`
  upsert path; free / rental / sample / preview / subscription / gift /
  reservation / unknown stay on `library_observation` and never create
  ownership. This is an import-side projection, not a generic content-layer
  inference, and it does not treat a visible label as official provider
  purchase authority.
- `GET|POST /api/sync-state/:source` for the three library sources reuses
  the existing sync-state table (last-synced marking after a successful run);
  legacy sources keep their existing handlers. The response is the strict
  `SyncStateResponseSchema` (`cursor`, `lastSyncedAt`, `latestOutcome`);
  unknown keys or malformed `latestOutcome` fail closed at every client
  boundary. Read-only mode allows `GET /api/sync-state/amazon|ebookjapan|kobo`
  while every POST (import / mark-synced) stays forbidden.
- `listing-display` / `lookup` are untouched: `productUrlForSource` returns
  `null` for the three new sources (no verified canonical product-URL
  evidence), so the new sources surface no product URL and no image
  provenance until a provider task supplies evidence.

### Extension

- `src/messages.ts`: `MSG_LIBRARY_SYNC` (popup → background),
  `MSG_LIBRARY_READ_PAGE` (background → content), `LIBRARY_PAGE_STATES` with
  the discriminated-union `LibraryPageReply`:
  `ready`/`empty` (with `items` + `nextPageUrl`), `login`, `page_not_ready`,
  or `{ok:false, error}`.
- `src/content/library.ts`: the generic content-side seam. Providers
  register one `LibraryPageReader` per source (`matchesLibraryUrl` gate +
  `readPage(doc, url)` returning a `LibraryPageReply`). The generic layer
  bounds batches (≤ `LIBRARY_BATCH_MAX` = 100), rejects unsafe next-page
  URLs (https, same host, no credentials), and passes every item state
  through untouched. The content script itself carries **no provider
  selectors**.
- `src/background/library-sync.ts`: `runLibrarySync(source)` — navigate to
  the provider start URL (reusing a tab already on the origin), poll for
  content-script readiness (500 ms interval, 30 s timeout), classify
  login / page-not-ready / empty / ready, import each visible batch to the
  local server, follow visible next-page links with a visited-URL set and a
  100-page maximum (any cycle terminates; an `empty` page never paginates),
  and `POST /api/rematch` + mark-synced **only after at least one successful
  batch**. Before a ready/empty page is counted, `reply.pageUrl` is validated
  against the source-specific canonical library URL
  (`isCanonicalLibraryPageUrl`); a wrong host, wrong path, wrong source, or a
  retained query/hash fails the run closed (`library_page_url_invalid`).
  `reply.nextPageUrl` is validated the same way before it is followed, so
  the sync never continues through a non-canonical or wrong-source next
  page. All failure paths are local error codes surfaced in the popup.
- `src/content/kobo-library.ts` (provider reader): the visible library URL
  gate accepts the observed path even with a temporary query (e.g.
  `code=REDACTED`) or hash; every returned and persisted page URL is
  normalized to `origin + pathname` (`/e-book/kobo/library` or
  `/page/<n>`), and only canonical next-page paths without query/hash are
  followed. Explicit visible `プレビュー`/`preview` evidence maps to the
  `preview` state; `立ち読み`/`試し読み`/`サンプル`/`sample`/`trial` map to
  `sample`; the selected 立ち読み版 view stays `sample` as a whole and the
  purchased view stays `purchased` unless a non-purchased marker applies.
- `src/popup/popup.ts` / `popup.html`: three user-triggered entry points
  (Amazon Kindle / ebookjapan / Kobo 同期). Clicking one only navigates and
  reads the library DOM — no login, purchase, cart, coupon, or other
  external mutation is initiated.
- `manifest.json`: **origin-level** `host_permissions`
  (`https://www.amazon.co.jp/*`, `https://ebookjapan.yahoo.co.jp/*`,
  `https://books.rakuten.co.jp/*`) because Chrome MV3 ignores the path
  component of host permissions — path-limited patterns would claim
  protection Chrome does not provide. Least privilege lives in the
  **path-limited** `content_scripts.matches` of `dist/content/library.js`:
  amazon/Kobo inject on their exact library paths plus descendants, while
  the ebookjapan canonical bookshelf is exact `/bookshelf` and `/bookshelf/`
  only — arbitrary `/bookshelf/*` subpaths are deliberately **not** claimed
  as content-script territory. `extension/package.json` `build:content`
  bundles it.

## Provider readers (implemented)

Each source registers a `LibraryPageReader` in `src/content/library.ts`:

1. `matchesLibraryUrl` recognizes the provider's library page (canonical
   path gate, same-host https, no credentials); anything else (sign-in
   redirect, wrong page) yields `login`.
2. `readPage` classifies the visible DOM (`login` / `page_not_ready` /
   `empty` / `ready`), extracts the visible batch (cid + title + explicit
   state + optional identity fields), and returns the visible next-page link
   if the provider renders one. No pagination control → `nextPageUrl: null`
   (one complete visible batch).
3. Ownership classification in the reader: visible DOM evidence maps to
   `LIBRARY_ITEM_STATES` only (never invent `purchased` from title/price).
   Which states become `listing` rows is **not** decided here — the server
   import layer already projects explicit `purchased` observations onto
   listing upsert; other states remain observation-only.
4. Every emitted/persisted page URL is normalized to the source canonical
   form before it leaves the reader (Kobo strips temporary query/hash;
   amazon/ebookjapan keep only their positive pagination parameter), and
   the background validates those canonical URLs again before counting or
   continuing.

## Remaining human gates

- **Provider authority:** a visible `purchased` marker is DOM evidence
  mapped to the owned state, not an official provider purchase record.
  Whether each provider's library DOM is an authoritative ownership source
  (and which regions/content types count) remains a human/legal gate
  (issues #43 / #44 / #46).
- **Purchase price authority:** price fields for the three library sources
  stay null/未取得; a store-backed purchase-price or current-price contract
  is not authorized yet (issue #45 decisions 1–3).
- **Issue #47 (関連製品・セール比較):** design-only contract; no
  related-products endpoint, sale comparison, or freshness display is
  implemented. Nothing in this wave implements or depends on it.

Price values for the three sources remain null/未取得 (no price contract in
this wave; DLsite/DMM-FANZA are the price targets).
