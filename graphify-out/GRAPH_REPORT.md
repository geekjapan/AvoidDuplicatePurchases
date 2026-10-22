# Graph Report - AvoidDuplicatePurchases  (2026-10-23)

## Corpus Check
- 50 semantic source files; AST status: extracted. Exclusions and reuse evidence: build-audit.json.

## Summary
- 2396 nodes · 6092 edges · 156 communities (109 shown, 47 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 96 edges (avg confidence: 0.85)
- Token usage: per-project usage unavailable (native Codex semantic extraction).

## Graph Freshness
- Built from commit: `336ed879`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- search-readers.ts
- shared/src/index.ts
- harness.ts
- purchase-gate/index.ts
- discovery.ts
- verify-adp.mjs
- http.ts
- ref_node_path
- fanza-doujin.ts
- runtime.mjs
- static.ts
- dlsite/index.ts
- release.mjs
- library-sync.ts
- parse-doujin.ts
- import.ts
- cart/price-comparison.ts
- origin-ui.ts
- isVisible
- services/related-products.ts
- messaging.ts
- dom-visibility.ts
- fanza_books/parse.ts
- shared/package.json
- ebookjapan-library.ts
- pages/price-comparison.ts
- ref_node_assert
- fanza/sync.ts
- server-client.ts
- discovery/identity.ts
- MockDocument
- fanza/fetch-stub.ts
- ref_node_sqlite
- server-api.ts
- content/price-observation.ts
- journey.e2e.test.ts
- amazon-library.ts
- progress-runner.ts
- MockElement
- export.ts
- routes/settings.ts
- common.ts
- src/identity.ts
- pages/library.ts
- sync/sync.ts
- services/price-observation.ts
- runner.test.ts
- fanza/index.ts
- related.ts
- mock-document.ts
- fanza-adapters.test.ts
- discovery/index.ts
- Source
- manual.ts
- router.ts
- alarms.ts
- src/messages.ts
- routes/candidates.ts
- routes/related-products.ts
- compilerOptions
- runner.ts
- routes/library.ts
- fanza_video/index.ts
- renderSettings
- manifest.json
- amazon-books.ts
- normalize.mjs
- readonly.test.ts
- admin/package.json
- popup.ts
- auto.ts
- listings.ts
- work.ts
- fanza_dlsoft/parse.ts
- dlsite-sync.ts
- server/package.json
- load
- happy-dom
- package.json
- extension/package.json
- amazon-library.test.ts
- endpoints.ts
- routes.ts
- library-async.test.ts
- parse-dlsite.ts
- admin/src/api.ts
- ebookjapan-library.test.ts
- extension/tsconfig.json
- amazon.ts
- ../tsconfig.base.json
- 003_library_sync_sources.sql
- dlsite/fetch-stub.ts
- 001_initial.sql
- ADP verification feature map
- scripts
- books.ts
- server/tsconfig.json
- devDependencies
- dlsite/tsconfig.json
- fanza_books/tsconfig.json
- fanza_dlsoft/tsconfig.json
- fanza_doujin/tsconfig.json
- fanza_video/tsconfig.json
- shared/tsconfig.json
- devDependencies
- devDependencies
- scripts
- AppDatabase
- collect-origin.sh
- run-js.sh
- 005_related_sales.sql
- scripts
- Release Distribution vocabulary
- amazon_observation
- ADP admin shell
- ADP agent working agreement
- ADR0001 fail-closed purchase progression
- Domain documentation
- GitHub issue tracker
- Triage labels
- Duplicate purchase domain glossary
- Browser DOM library synchronization contract
- Current-store library acceptance
- Issue42 historical integration audit
- Amazon Kindle research and reader
- ebookjapan library research and reader
- Nullable library display and price contract
- Price observation acceptance
- Rakuten Kobo research
- Related sales synthetic acceptance
- Related products and market offer contract
- Owned FANZA DLsite price comparison
- DLsite FANZA OSS scraper research
- Duplicate purchase prevention specification
- DLsite duplicated cart fixture
- FANZA Books cart fixture
- FANZA Doujin cart fixture
- DLsite discovery fixture: product candidates, duplicate ID and excluded cart link
- FANZA discovery fixture: valid product URLs, rejected lookalike host and wishlist route
- DLsite listing fixture exposes RJ111111 and RJ222222 product links
- DLsite product fixture with canonical work ID, maker and add-cart/immediate-buy controls
- FANZA Books listing fixture with series and content IDs
- FANZA Books product fixture with canonical URL, JSON-LD name/brand and purchase controls
- FANZA doujin listing fixture with content IDs
- FANZA doujin product fixture with canonical URL, JSON-LD brand and purchase controls
- Duplicate-purchase popup exposes DLsite, Kindle, ebookjapan and Kobo sync actions
- ADP continuous integration
- Approved release publication workflow
- Release candidate workflow
- CartDeleter remove/restore adapters: DLsite GET, FANZA doujin DELETE with CSRF, Books POST; no automatic removal
- DLsite research: sales API backfill and cursor, product.json metadata, deduplicated cart workno
- FANZA research: distinct store APIs; nullable purchase dates; Books series/volume traversal; video rights date is not purchase date
- Normalization research: exact normalized title merges, maker-gated Dice review queue; preserve meaningful brackets and trial variants
- AvoidDuplicatePurchases v1 user guide
- Serena project configuration

## God Nodes (most connected - your core abstractions)
1. `handleApi()` - 45 edges
2. `MockDocument` - 43 edges
3. `isVisible()` - 40 edges
4. `MockElement` - 34 edges
5. `visibleTextOf()` - 27 edges
6. `runCartPage()` - 25 edges
7. `openDatabase()` - 25 edges
8. `fail()` - 24 edges
9. `InterventionSource` - 23 edges
10. `recomputeMatchKeys()` - 22 edges

## Surprising Connections (you probably didn't know these)
- `PriceObservationRow` --references--> `Money`  [EXTRACTED]
  server/src/services/price-observation.ts → shared/src/api.ts
- `LibrarySyncOutcome` --references--> `LibrarySource`  [EXTRACTED]
  extension/src/background/library-sync.ts → shared/src/identity.ts
- `LibrarySyncMessage` --references--> `LibrarySource`  [EXTRACTED]
  extension/src/background/messaging.ts → shared/src/identity.ts
- `CartLookupItem` --references--> `InterventionSource`  [EXTRACTED]
  extension/src/content/cart/types.ts → shared/src/identity.ts
- `ListingSide` --references--> `Source`  [EXTRACTED]
  server/src/routes/candidates.ts → shared/src/identity.ts

## Import Cycles
- None detected.

## Communities (156 total, 47 thin omitted)

### Community 0 - "search-readers.ts"
Cohesion: 0.06
Nodes (67): ADP_BANNER_ID, approvedStoreHttpsUrl(), formatOwnedBannerText(), formatPurchaseDate(), mountProductBanner(), renderProductBanner(), selectRenderableOther(), SOURCE_LABELS (+59 more)

### Community 1 - "shared/src/index.ts"
Cohesion: 0.06
Nodes (71): AbsoluteHttpsUrl, AbsoluteHttpUrl, CandidateDecisionSchema, CandidateIdPathSchema, CandidatePairSchema, CandidatesQuerySchema, CurrentPrice, CurrentPriceSchema (+63 more)

### Community 2 - "harness.ts"
Cohesion: 0.07
Nodes (51): actionSchema, cliArgsSchema, main(), parseArgs(), ParsedCliArgs, selectResults(), siteSchema, usage() (+43 more)

### Community 3 - "purchase-gate/index.ts"
Cohesion: 0.09
Nodes (41): applyConfirmedDuplicateGate(), applyProductImmediateBuyGate(), CART_ADD_LABELS, findPurchaseCtas(), isInteractive(), labelMatches(), normalizeLabel(), PROGRESS_LABELS (+33 more)

### Community 4 - "discovery.ts"
Cohesion: 0.07
Nodes (41): AllowedCandidate, AWAITING_SELECTION_TTL_MS, cancelSessionsForOriginTab(), cleanupSession(), clearExpiryTimer(), DEFAULT_POLL_INTERVAL_MS, DEFAULT_READINESS_TIMEOUT_MS, discoveryAllowedCountForTests() (+33 more)

### Community 5 - "verify-adp.mjs"
Cohesion: 0.10
Nodes (42): api(), assertIsolated(), axLabel(), browser(), Cdp, CHROME_CANDIDATES, connectPage(), delay() (+34 more)

### Community 6 - "http.ts"
Cohesion: 0.07
Nodes (39): CommitCursorRequestSchema, forbidden(), handleApi(), ImportAdvanceFlagSchema, json(), notFound(), OutcomeSourcePathSchema, parseZod() (+31 more)

### Community 7 - "ref_node_path"
Cohesion: 0.06
Nodes (25): backgroundEntry, __dirname, extensionRoot, serviceWorkerBundleOptions, CART_BOOT_MARKERS, CONTENT_ENTRIES, CONTENT_OUTPUTS, contentBundleOptions (+17 more)

### Community 8 - "fanza-doujin.ts"
Cohesion: 0.13
Nodes (31): boot(), boot(), boot(), isCartInterventionPage(), fetchBooksCartCids(), fetchDoujinCartCids(), fetchDoujinCartRows(), defaultLookupCounterpart() (+23 more)

### Community 9 - "runtime.mjs"
Cohesion: 0.13
Nodes (39): bundleIsReady(), checkLabel(), CONFIG_PATH, configuredPort(), delay(), extensionIdFromConfig(), installRuntimeDependencies(), isManagedProcess() (+31 more)

### Community 10 - "static.ts"
Cohesion: 0.10
Nodes (32): startFullServer(), isAllowedOrigin(), joinDefaultDbPath(), loadConfig(), isReadonlyMode(), openReadonlyDatabase(), ServerConfig, openDatabase() (+24 more)

### Community 11 - "dlsite/index.ts"
Cohesion: 0.14
Nodes (31): DlsiteProductItemSchema, OptionalNullableString, parseDlsiteProductJson(), compareUtcIsoInstants(), DlsiteSaleEntrySchema, DlsiteSalesArraySchema, isStrictUtcIsoInstant(), listingFromSale() (+23 more)

### Community 12 - "release.mjs"
Cohesion: 0.16
Nodes (37): ADMIN_DIST_FILES, assertAllowedBundlePaths(), assertManifest(), assertNoCredentials(), auditSummary(), buildRuntimePackage(), candidate(), checkResult() (+29 more)

### Community 13 - "library-sync.ts"
Cohesion: 0.10
Nodes (27): DEFAULT_MAX_PAGES, DEFAULT_POLL_INTERVAL_MS, DEFAULT_READINESS_TIMEOUT_MS, getOrCreateTab(), LibrarySyncDeps, nextPageUrl(), runLibrarySync(), sleep() (+19 more)

### Community 14 - "parse-doujin.ts"
Cohesion: 0.10
Nodes (28): BooksProductIdsPayloadSchema, fetchBooksCartRows(), NonBlankString, parseBooksCartRowsFromPayload(), parseBooksCartRowsFromProductIds(), readBooksRowFromDom(), apiFinalPrice(), DoujinBasketItemSchema (+20 more)

### Community 15 - "import.ts"
Cohesion: 0.08
Nodes (26): advanceCursor(), commitDlsiteCursor(), getSyncState(), ImportCounts, importDlsitePayload(), ImportOptions, mapWithConcurrency(), PRODUCT_FETCH_CONCURRENCY (+18 more)

### Community 16 - "cart/price-comparison.ts"
Cohesion: 0.10
Nodes (27): CartPriceSource, compareFinalPrices(), finalPriceTiers(), FinalPriceVerdict, formatFinalPrice(), parseCartPriceValue(), readCartFinalPrice(), readDataPrice() (+19 more)

### Community 17 - "origin-ui.ts"
Cohesion: 0.10
Nodes (31): ADP_DISCOVERY_PANEL_ID, clearResults(), compareTierDisplay(), ComparisonTier, ComparisonTierDisplay, ensurePanel(), FAILURE_MESSAGES, formatTier() (+23 more)

### Community 18 - "isVisible"
Cohesion: 0.17
Nodes (26): isVisible(), activeLibraryView(), buildItems(), canonicalPageUrl(), hasClass(), hasLibraryShell(), imageUrlOf(), isActiveControl() (+18 more)

### Community 19 - "services/related-products.ts"
Cohesion: 0.10
Nodes (31): buildMarketOfferPrice(), compareItems(), computeFreshness(), EdgeRow, FRESHNESS_RANK, getRelatedProducts(), importRelatedProducts(), ListingIdentityRow (+23 more)

### Community 20 - "messaging.ts"
Cohesion: 0.10
Nodes (28): AmazonSyncOutcome, runAmazonManualSync(), LibrarySyncOutcome, AmazonSyncMessage, AmazonSyncReply, extraHandlers, handleLookup(), isLibrarySource() (+20 more)

### Community 21 - "dom-visibility.ts"
Cohesion: 0.18
Nodes (28): attributeOf(), collectVisibleText(), computedStyleOf(), DISPLAY_TOKENS, ElementLike, hasAttribute(), inlineDeclaration(), inlineStyleValue() (+20 more)

### Community 22 - "fanza_books/parse.ts"
Cohesion: 0.13
Nodes (26): booksContentsHasNext(), booksContentsPageInfo(), booksLibraryHasNext(), booksLibraryPageInfo(), ContentsPageSchema, ImportBodySchema, LibraryPageSchema, NonBlankString (+18 more)

### Community 23 - "shared/package.json"
Cohesion: 0.07
Nodes (29): import, types, import, types, import, types, import, types (+21 more)

### Community 24 - "ebookjapan-library.ts"
Cohesion: 0.17
Nodes (22): activeShelfTab(), buildItems(), canonicalPageUrl(), EbookjapanDocument, EbookjapanElement, firstVisible(), hasBookshelfShell(), hasClass() (+14 more)

### Community 25 - "pages/price-comparison.ts"
Cohesion: 0.15
Nodes (25): Listing, compareTier(), comparisonSummaryLabel(), el(), errorMessage(), filterComparisonListings(), groupByWorkId(), isPriceComparisonSource() (+17 more)

### Community 26 - "ref_node_assert"
Cohesion: 0.09
Nodes (10): __dirname, distRoot, extensionRoot, EXPORT_FILENAME, clearSyncSuccessListeners(), __dirname, request(), startTestServer() (+2 more)

### Community 27 - "fanza/sync.ts"
Cohesion: 0.16
Nodes (17): importFanzaOnServer(), markFanzaSyncedOnServer(), assertProgress(), evaluatePage(), fetchJson(), fetchVideoJson(), fetchVideoJsonInPage(), PageMeta (+9 more)

### Community 28 - "server-client.ts"
Cohesion: 0.13
Nodes (21): AmazonBooksPage, AmazonSyncDeps, emptyCounts, SyncDeps, AmazonImportCounts, AmazonImportCountsSchema, commitDlsiteCursorOnServer(), DEFAULT_SERVER_PORT (+13 more)

### Community 29 - "discovery/identity.ts"
Cohesion: 0.18
Nodes (22): IdentityGateOutcome, makerKeysEqual(), OriginIdentity, RELEVANCE_DICE_THRESHOLD, scoreDiscoveryCandidates(), titlePreVolumeKey(), DiscoveryCandidate, getOwnedListing() (+14 more)

### Community 30 - "MockDocument"
Cohesion: 0.19
Nodes (21): dlsiteProductDoc(), fanzaProductDoc(), dlsiteBareDefinitionListSearchDoc(), dlsiteChromeListProductDoc(), dlsiteDefinitionListSearchDoc(), dlsiteDefinitionListSelfShellSearchDoc(), dlsiteDefinitionListTruncatedTitleSearchDoc(), dlsiteDivWork1ColSearchDoc() (+13 more)

### Community 31 - "fanza/fetch-stub.ts"
Cohesion: 0.08
Nodes (14): BOOKS_BASKET_URL, BooksContentsPage, BooksVolume, DOUJIN_BASKET_URL, DOUJIN_LIMIT_MAX, DoujinItem, DoujinLibraryPage, parseDoujinPage() (+6 more)

### Community 32 - "ref_node_sqlite"
Cohesion: 0.14
Nodes (17): insertListing(), __dirname, fixtures, insertListing(), SYNTHETIC_FANZA_DOUJIN_IMPORT_PAYLOAD, __dirname, fixtures, insertListing() (+9 more)

### Community 33 - "server-api.ts"
Cohesion: 0.14
Nodes (23): ALL_SYNC_SOURCES, FANZA_SOURCES, FanzaImportResult, FanzaImportSource, FULL_SYNC_OUTCOME_SOURCE, getAllSyncStates(), getFullSyncOutcome(), getSourceSyncState() (+15 more)

### Community 34 - "content/price-observation.ts"
Cohesion: 0.15
Nodes (23): DLSITE_COUPON_LABELS, DLSITE_REGULAR_EXACT_LABELS, DLSITE_REGULAR_LABELS, DLSITE_SALE_LABELS, DMM_COUPON_LABELS, DMM_REGULAR_LABELS, DMM_SALE_LABELS, elementOwnText() (+15 more)

### Community 35 - "journey.e2e.test.ts"
Cohesion: 0.09
Nodes (16): ADMIN_DIST, ADMIN_SRC_MAIN, apiRequest(), defineGlobal(), __dirname, installDom(), ListingRow, REPO_ROOT (+8 more)

### Community 36 - "amazon-library.ts"
Cohesion: 0.19
Nodes (18): AmazonLibraryDocument, AmazonLibraryElement, asinFromTitleId(), buildItems(), canonicalPageUrl(), firstVisible(), hasLaterVisiblePage(), imageUrlOf() (+10 more)

### Community 37 - "progress-runner.ts"
Cohesion: 0.14
Nodes (19): normalizeCartCidLoad(), hideDiscoveryOriginUi(), LookupRequestItem, RawLookupReply, collectConfirmedDuplicateCids(), ConfirmedCidHit, hasConfirmedDuplicate(), isConfirmedDuplicate() (+11 more)

### Community 39 - "export.ts"
Cohesion: 0.17
Nodes (22): aggregate(), applySnapshotMode(), assertNoSymlinkComponents(), assertPinnedPathIdentity(), assertPinnedStagedIdentity(), canonicalOperationPath(), DirectoryPin, ensureDestinationDirectory() (+14 more)

### Community 40 - "routes/settings.ts"
Cohesion: 0.16
Nodes (21): handleExportRoute(), json(), parseZod(), readBody(), registerExportRoutes(), ApiContext, ApiRouteMount, mounts (+13 more)

### Community 41 - "common.ts"
Cohesion: 0.13
Nodes (21): dispatchSyncSuccess(), deepMergeEvidence(), ensureOriginInstanceId(), getLatestSyncOutcome(), mergeRawJsonEvidence(), originByDb, outcomeSourceKey(), parseOutcomePublic() (+13 more)

### Community 42 - "src/identity.ts"
Cohesion: 0.14
Nodes (21): LibraryImportItemSchema, LibraryImportRequestSchema, LibraryImportResponseSchema, LibrarySourceSchema, SourceSchema, canonicalLibraryProductUrl(), hasOnlyPositiveQuery(), INTERVENTION_SOURCES (+13 more)

### Community 43 - "pages/library.ts"
Cohesion: 0.22
Nodes (21): assignWork(), currentPriceLabel(), el(), errorMessage(), groupByWork(), imageForListing(), moneyLabel(), priceObservationLabel() (+13 more)

### Community 44 - "sync/sync.ts"
Cohesion: 0.16
Nodes (19): el(), errorMessage(), fetchSyncState(), formatFetchError(), formatLastSynced(), formatOutcome(), LoadStatesResult, postManualListing() (+11 more)

### Community 45 - "services/price-observation.ts"
Cohesion: 0.15
Nodes (20): handlePriceObservationRoute(), json(), parseZod(), readBody(), registerPriceObservationRoutes(), canonicalizeOwnedProductUrl(), isPriceObservationSource(), loadPriceObservation() (+12 more)

### Community 46 - "runner.test.ts"
Cohesion: 0.18
Nodes (15): ADP_CART_STYLE_ID, CART_CSS, ensureCartStyles(), __dirname, fixtures, ADP_CART_TOAST_ID, detachNode(), showUndoToast() (+7 more)

### Community 47 - "fanza/index.ts"
Cohesion: 0.19
Nodes (10): importFanzaBooksPayload(), ImportCounts, importListingBatch(), FanzaDlsoftImportResult, importFanzaDlsoftPayload(), FanzaDoujinImportResult, importFanzaDoujinPayload(), importPayload() (+2 more)

### Community 48 - "related.ts"
Cohesion: 0.23
Nodes (18): fetchListings(), fetchRelatedProducts(), el(), errorMessage(), evidenceLabel(), freshnessLabel(), moneyLabel(), ownershipLabel() (+10 more)

### Community 49 - "mock-document.ts"
Cohesion: 0.15
Nodes (12): appendTextChild(), buildCartFixtureDocument(), koboLibraryPageReader, addItem(), addShell(), el(), HiddenMode, hideWith() (+4 more)

### Community 50 - "fanza-adapters.test.ts"
Cohesion: 0.19
Nodes (15): DoujinItemSchema, doujinPageHasNext(), doujinPageInfo(), DoujinPageSchema, itemEvidence(), listingFromItem(), NonBlankString, parseDoujinMylibrariesPayload() (+7 more)

### Community 51 - "discovery/index.ts"
Cohesion: 0.23
Nodes (16): buildDiscoverySearchUrl(), buildDiscoverySearchUrls(), counterpartSource(), DiscoverySearchQuery, DLSITE_TITLE_CODEPOINT_LIMIT, FANZA_DOUJIN_TITLE_CODEPOINT_LIMIT, MAX_URL_LENGTH, sanitizeSearchTitle() (+8 more)

### Community 52 - "Source"
Cohesion: 0.14
Nodes (15): ListingSide, ListingRow, rowToListing(), ParsedProductUrl, ImageProvenance, imageProvenanceFor(), ListingDisplayInput, listingDisplayMetadata() (+7 more)

### Community 53 - "manual.ts"
Cohesion: 0.24
Nodes (16): decodeIdentitySegment(), enrichDlsiteListing(), handleManualRoute(), hasInvalidPercentEncoding(), isSafeFanzaCid(), json(), listingRow(), onlyAllowedQueryKeys() (+8 more)

### Community 54 - "router.ts"
Cohesion: 0.19
Nodes (15): app, header, links, main, nav, navigate(), setActive(), showShellError() (+7 more)

### Community 55 - "alarms.ts"
Cohesion: 0.21
Nodes (13): persistFullSyncOutcomeOnServer(), persistSyncOutcomeOnServer(), anyImportsMayHavePersisted(), combineFullSyncError(), executeFullSync(), handleDailySyncAlarm(), persistLatestOutcomes(), registerAlarms() (+5 more)

### Community 56 - "src/messages.ts"
Cohesion: 0.12
Nodes (15): DISCOVERY_FAILURE_CODES, DISCOVERY_SOURCES, DiscoveryCandidateSchema, DiscoveryMoney, DiscoveryMoneySchema, DiscoveryPriceTiersSchema, DiscoveryReadProductMessage, DiscoveryReadSearchMessage (+7 more)

### Community 57 - "routes/candidates.ts"
Cohesion: 0.24
Nodes (15): conflict(), createWork(), DecisionAbort, deleteCandidatesForListings(), ensureWorkExists(), handleCandidatesRoute(), json(), ListingWorkRow (+7 more)

### Community 58 - "routes/related-products.ts"
Cohesion: 0.20
Nodes (15): handleRelatedImport(), handleRelatedProductsGet(), handleRelatedRoutes(), json(), parseZod(), queryObject(), readBody(), registerRelatedProductsRoutes() (+7 more)

### Community 59 - "compilerOptions"
Cohesion: 0.12
Nodes (15): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution (+7 more)

### Community 60 - "runner.ts"
Cohesion: 0.19
Nodes (13): interventionToCartSource(), allPriceComparisonsMounted(), CartCidLoader, CartRowObserver, CartRowParser, LookupFn, mergeRows(), mountPriceComparisons() (+5 more)

### Community 61 - "routes/library.ts"
Cohesion: 0.25
Nodes (13): getSyncState(), markSourceSynced(), emptyLibraryImportCounts(), importLibraryBatch(), LibraryImportCounts, upsertLibraryObservation(), handleLibraryRoute(), isLibrarySource() (+5 more)

### Community 62 - "fanza_video/index.ts"
Cohesion: 0.23
Nodes (11): itemEvidence(), NonBlankString, parseVideoGraphqlPayload(), VideoItemSchema, videoPageHasNext(), videoPageInfo(), VideoPageSchema, FanzaVideoParsedListing (+3 more)

### Community 63 - "renderSettings"
Cohesion: 0.24
Nodes (11): AdminSettings, el(), errorMessage(), fetchSettings(), renderSettings(), load(), setPending(), setStatus() (+3 more)

### Community 64 - "manifest.json"
Cohesion: 0.14
Nodes (13): action, default_popup, default_title, background, service_worker, type, content_scripts, description (+5 more)

### Community 65 - "amazon-books.ts"
Cohesion: 0.25
Nodes (9): AmazonBooksDocument, AmazonBooksElement, isAmazonBooksPageUrl(), pageNumberFromUrl(), parseAmazonBooksDocument(), readAmazonBooksPage(), appendField(), appendRow() (+1 more)

### Community 66 - "normalize.mjs"
Cohesion: 0.36
Nodes (13): BRACKETS, dice(), key(), l1(), l2(), l3(), l4(), l5() (+5 more)

### Community 67 - "readonly.test.ts"
Cohesion: 0.16
Nodes (9): dirFingerprint(), __dirname, end(), PRODUCTION_ENTRY_FIXTURE, request(), sha256(), TEST_EXTENSION_ORIGINS, UNKNOWN_WRITE_METHODS (+1 more)

### Community 68 - "admin/package.json"
Cohesion: 0.15
Nodes (12): dependencies, @adp/shared, esbuild, tsx, name, private, scripts, build (+4 more)

### Community 69 - "popup.ts"
Cohesion: 0.28
Nodes (11): MSG_SERVER_STATUS, bootPopup(), refreshStatus(), runLibrarySync(), createSyncControlGate(), LIBRARY_BUTTONS, LIBRARY_ERROR_MESSAGES, librarySyncError() (+3 more)

### Community 70 - "auto.ts"
Cohesion: 0.24
Nodes (11): ExportSnapshotFn, installAutoExport(), InstallAutoExportOptions, shouldAutoExportForDb(), ExportResult, listeners, subscribeSyncSuccess(), SyncSuccessListener (+3 more)

### Community 71 - "listings.ts"
Cohesion: 0.29
Nodes (12): compareNullableNumber(), compareNullableString(), handleListingsRoute(), json(), matchesTextQuery(), observationMatchesCurrency(), observationTierAmount(), parseZod() (+4 more)

### Community 72 - "work.ts"
Cohesion: 0.31
Nodes (12): allocateNewWork(), deleteCandidatesForListing(), ensureWorkExists(), handleWorkRoute(), json(), LocalWorkAssignmentSchema, notFound(), parseZod() (+4 more)

### Community 73 - "fanza_dlsoft/parse.ts"
Cohesion: 0.26
Nodes (9): dlsoftPageHasNext(), dlsoftPageInfo(), itemEvidence(), LibraryItemSchema, LibraryPageSchema, NonBlankString, parseDlsoftLibraryPayload(), FanzaDlsoftParsedListing (+1 more)

### Community 74 - "dlsite-sync.ts"
Cohesion: 0.26
Nodes (6): FullSyncDeps, chunkSales(), IMPORT_CHUNK_SIZE, maxCursorFromSales(), runDlsiteSync(), __dirname

### Community 75 - "server/package.json"
Cohesion: 0.18
Nodes (10): @adp/shared, dependencies, @adp/shared, devDependencies, tsx, tsx, name, private (+2 more)

### Community 76 - "load"
Cohesion: 0.40
Nodes (10): apiFetch(), decideCandidate(), fetchCandidates(), el(), errorMessage(), listingBlock(), renderCandidates(), clearStatus() (+2 more)

### Community 77 - "happy-dom"
Cohesion: 0.22
Nodes (6): defineGlobal(), installDom(), ListingPayload, defineGlobal(), installDom(), happy-dom

### Community 78 - "package.json"
Cohesion: 0.20
Nodes (9): typescript, name, private, type, workspaces, eslint, @eslint/js, @types/node (+1 more)

### Community 79 - "extension/package.json"
Cohesion: 0.18
Nodes (10): dependencies, @adp/shared, zod, tsx, zod, name, private, type (+2 more)

### Community 80 - "amazon-library.test.ts"
Cohesion: 0.35
Nodes (9): amazonLibraryPageReader, addCount(), addPagination(), addRow(), appendImage(), appendLink(), applyVisibility(), field() (+1 more)

### Community 81 - "endpoints.ts"
Cohesion: 0.24
Nodes (7): booksDelete(), buildDeleteRequests(), DeleteRequest, dlsiteDelete(), doujinDelete(), JSON_HEADERS, Source

### Community 82 - "routes.ts"
Cohesion: 0.31
Nodes (10): FANZA_SOURCES, FanzaSource, handleFanzaRoute(), isFanzaSource(), json(), MarkSyncedRequestSchema, parseZod(), readBody() (+2 more)

### Community 83 - "library-async.test.ts"
Cohesion: 0.24
Nodes (7): assertControlsDisabled(), controls(), defineGlobal(), Held, installDom(), ListingPayload, SAMPLE

### Community 84 - "parse-dlsite.ts"
Cohesion: 0.42
Nodes (8): DlsiteWorknoSchema, encodeDlsiteWorknoForUrl(), parseDlsiteWorkno(), directClassToken(), parseDlsiteCartRows(), readDlsiteCartMaker(), readDlsiteCartTitle(), readElementLabel()

### Community 85 - "admin/src/api.ts"
Cohesion: 0.22
Nodes (8): RelatedAnchorSource, RelatedProducts, WorkAssignOptions, CandidatesResponseSchema, ListingsResponse, ListingsResponseSchema, RelatedProductsResponse, WorkAssignmentResponseSchema

### Community 86 - "ebookjapan-library.test.ts"
Cohesion: 0.31
Nodes (8): ebookjapanLibraryPageReader, addItem(), addShell(), el(), INVISIBLE_DOM_STATES, InvisibleDomState, markInvisible(), markShellInvisible()

### Community 87 - "extension/tsconfig.json"
Cohesion: 0.22
Nodes (8): compilerOptions, lib, outDir, rootDir, exclude, extends, files, include

### Community 88 - "amazon.ts"
Cohesion: 0.39
Nodes (8): AmazonImportRequestSchema, AmazonItemSchema, handleAmazonRoute(), isAmazonBooksPageUrl(), json(), parseZod(), readBody(), validationError()

### Community 89 - "../tsconfig.base.json"
Cohesion: 0.25
Nodes (7): compilerOptions, lib, noEmit, rootDir, extends, include, ../tsconfig.base.json

### Community 90 - "003_library_sync_sources.sql"
Cohesion: 0.25
Nodes (4): library_observation, listing_new, listing_work, price_observation

### Community 91 - "dlsite/fetch-stub.ts"
Cohesion: 0.29
Nodes (5): demo(), fetchProductInfo(), ProductInfo, SaleEntry, WORKNO_RE

### Community 92 - "001_initial.sql"
Cohesion: 0.43
Nodes (7): candidate, listing, listing_work, match_key, match_key_lookup, sync_state, work

### Community 93 - "ADP verification feature map"
Cohesion: 0.29
Nodes (7): Candidate queue verification, Library verification, Price-comparison verification, ADP verification feature map, Settings verification, Sync verification, Isolated ADP admin verification harness

### Community 94 - "scripts"
Cohesion: 0.29
Nodes (7): scripts, build, build:content, build:popup, build:sw, test, test:e2e

### Community 96 - "server/tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, outDir, rootDir, extends, files, include

### Community 97 - "devDependencies"
Cohesion: 0.33
Nodes (6): devDependencies, eslint, @eslint/js, @types/node, typescript, typescript-eslint

### Community 98 - "dlsite/tsconfig.json"
Cohesion: 0.33
Nodes (5): compilerOptions, outDir, rootDir, extends, include

### Community 99 - "fanza_books/tsconfig.json"
Cohesion: 0.33
Nodes (5): compilerOptions, outDir, rootDir, extends, include

### Community 100 - "fanza_dlsoft/tsconfig.json"
Cohesion: 0.33
Nodes (5): compilerOptions, outDir, rootDir, extends, include

### Community 101 - "fanza_doujin/tsconfig.json"
Cohesion: 0.33
Nodes (5): compilerOptions, outDir, rootDir, extends, include

### Community 102 - "fanza_video/tsconfig.json"
Cohesion: 0.33
Nodes (5): compilerOptions, outDir, rootDir, extends, include

### Community 103 - "shared/tsconfig.json"
Cohesion: 0.33
Nodes (5): compilerOptions, outDir, rootDir, extends, include

### Community 104 - "devDependencies"
Cohesion: 0.40
Nodes (5): devDependencies, esbuild, happy-dom, tsx, typescript

### Community 105 - "devDependencies"
Cohesion: 0.40
Nodes (5): devDependencies, esbuild, tsx, @types/chrome, typescript

### Community 106 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, build, lint, start, test

### Community 108 - "collect-origin.sh"
Cohesion: 0.83
Nodes (3): osa(), run(), collect-origin.sh script

### Community 109 - "run-js.sh"
Cohesion: 0.83
Nodes (3): osa(), run(), run-js.sh script

### Community 110 - "005_related_sales.sql"
Cohesion: 0.67
Nodes (3): market_offer, related_edge, related_edge_anchor

### Community 111 - "scripts"
Cohesion: 0.50
Nodes (4): scripts, build, start, test

## Knowledge Gaps
- **64 isolated node(s):** `tsx`, `tsx`, `zod`, `ADR-0001`, `ADR-0001` (+59 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 703 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **47 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `happy-dom` connect `happy-dom` to `journey.e2e.test.ts`, `admin/package.json`, `sync/sync.ts`, `related.ts`, `library-async.test.ts`, `renderSettings`?**
  _High betweenness centrality (0.065) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `handleApi()` (e.g. with `startServer()` and `readonly.test.ts`) actually correct?**
  _`handleApi()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `tsx`, `tsx`, `zod` to the rest of the system?**
  _64 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `search-readers.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06323396567299007 - nodes in this community are weakly interconnected._
- **Why does `MockElement` connect `MockElement` to `search-readers.ts`, `amazon-library.test.ts`, `mock-document.ts`, `origin-ui.ts`, `ebookjapan-library.test.ts`, `MockDocument`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Should `shared/src/index.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05981981981981982 - nodes in this community are weakly interconnected._
- **Why does `typescript` connect `package.json` to `admin/package.json`, `extension/package.json`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._