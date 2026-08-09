/**
 * Package-entrypoint regression: import via `@adp/shared` exports (dist),
 * not `../src/index.js`. Fails when tracked dist drifts from the public surface.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Runtime value exports re-exported from shared/src/index.ts (api + core). */
const REQUIRED_EXPORTS = [
  // identity
  "SOURCES",
  "INTERVENTION_SOURCES",
  "LIBRARY_SOURCES",
  "LIBRARY_ITEM_STATES",
  "LIBRARY_SYNC_PROVIDERS",
  "productKey",
  "normalizeCid",
  "makeProductIdentity",
  "librarySyncProvider",
  // normalize
  "BRACKETS",
  "l1",
  "l2",
  "l3",
  "l4",
  "l5",
  "key",
  "dice",
  "stripAllBrackets",
  "titleMatchKey",
  "makerMatchKey",
  "assertNormalizationSelfCheck",
  // cart
  "dlsiteDelete",
  "dlsiteRestore",
  "doujinDelete",
  "doujinRestore",
  "booksDelete",
  "booksRestore",
  "buildDeleteRequests",
  "buildRestoreRequests",
  // api schemas (must stay in sync with shared/src/index.ts)
  "SourceSchema",
  "LibrarySourceSchema",
  "LibraryItemStateSchema",
  "LibraryImportItemSchema",
  "LibraryImportRequestSchema",
  "LibraryImportResponseSchema",
  "LookupItemSchema",
  "LookupRequestSchema",
  "LookupOtherSchema",
  "LookupResultSchema",
  "LookupResponseSchema",
  "SourcePathSchema",
  "ImportRequestSchema",
  "ImportResponseSchema",
  "SyncStateResponseSchema",
  "SyncOutcomeSchema",
  "CandidatePairSchema",
  "CandidatesQuerySchema",
  "CandidatesResponseSchema",
  "CandidateIdPathSchema",
  "CandidateDecisionSchema",
  "EmptyRequestSchema",
  "EmptyResponseSchema",
  "RematchRequestSchema",
  "RematchResponseSchema",
  "ListingsQuerySchema",
  "ListingsSortSchema",
  "PriceObservationTierSchema",
  "ListingSchema",
  "ListingsResponseSchema",
  "MoneySchema",
  "CurrentPriceSchema",
  "PriceObservationSchema",
  "PriceObservationRequestSchema",
  "PriceObservationResponseSchema",
  "ManualListingRequestSchema",
  "ManualListingResponseSchema",
  "ListingWorkPathSchema",
  "WorkAssignmentRequestSchema",
  "WorkAssignmentResponseSchema",
  "ExportRequestSchema",
  "ExportResponseSchema",
] as const;

describe("@adp/shared package entrypoint (exports → dist)", () => {
  it("resolves the package name to dist/index.js, not src", () => {
    // ESM package exports resolution (import condition), not require.resolve.
    const resolved = import.meta.resolve("@adp/shared");
    assert.match(
      resolved.replaceAll("\\", "/"),
      /\/shared\/dist\/index\.js$/,
      `expected package entrypoint under shared/dist, got ${resolved}`,
    );
  });

  it("exposes the full public runtime export surface", async () => {
    // Import by package name so Node applies package.json "exports".
    const mod = (await import("@adp/shared")) as Record<string, unknown>;

    const missing = REQUIRED_EXPORTS.filter((name) => !(name in mod));
    assert.deepEqual(
      missing,
      [],
      `package entrypoint missing exports (dist stale?): ${missing.join(", ")}`,
    );
  });

  it("LookupItemSchema rejects empty identity at the published entrypoint", async () => {
    const { LookupItemSchema } = await import("@adp/shared");
    assert.throws(() => LookupItemSchema.parse({}));
    assert.throws(() => LookupItemSchema.parse({ cid: "" }));
    assert.throws(() => LookupItemSchema.parse({ title: "   " }));
    assert.equal(
      LookupItemSchema.parse({ source: "dlsite", cid: "RJ000001" }).cid,
      "RJ000001",
    );
  });

  it("assertNormalizationSelfCheck does not throw on the published entrypoint", async () => {
    const { assertNormalizationSelfCheck, titleMatchKey } =
      await import("@adp/shared");
    assert.doesNotThrow(() => assertNormalizationSelfCheck());
    assert.notEqual(titleMatchKey("作品【演者A】"), titleMatchKey("作品【演者B】"));
  });
});
