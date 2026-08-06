import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CandidateDecisionSchema,
  CandidateIdPathSchema,
  CandidatesQuerySchema,
  CandidatesResponseSchema,
  EmptyRequestSchema,
  EmptyResponseSchema,
  ExportRequestSchema,
  ExportResponseSchema,
  ImportRequestSchema,
  ImportResponseSchema,
  ListingSchema,
  ListingWorkPathSchema,
  ListingsQuerySchema,
  ListingsResponseSchema,
  LookupItemSchema,
  LookupRequestSchema,
  LookupResponseSchema,
  ManualListingRequestSchema,
  ManualListingResponseSchema,
  RematchRequestSchema,
  RematchResponseSchema,
  SourcePathSchema,
  SyncStateResponseSchema,
  WorkAssignmentRequestSchema,
  WorkAssignmentResponseSchema,
} from "../src/index.js";

describe("LookupItemSchema identity requirements", () => {
  it("accepts source+cid identity", () => {
    const item = LookupItemSchema.parse({ source: "dlsite", cid: "RJ000001" });
    assert.equal(item.cid, "RJ000001");
  });

  it("accepts title-only identity for cross-store match", () => {
    const item = LookupItemSchema.parse({ title: "ある作品" });
    assert.equal(item.title, "ある作品");
  });

  it("rejects empty object", () => {
    assert.throws(() => LookupItemSchema.parse({}), /cid or title|Required/i);
  });

  it("rejects empty strings and blank-only fields", () => {
    assert.throws(() => LookupItemSchema.parse({ cid: "" }));
    assert.throws(() => LookupItemSchema.parse({ title: "" }));
    assert.throws(() => LookupItemSchema.parse({ cid: "   " }));
    assert.throws(() => LookupItemSchema.parse({ title: "\t" }));
    assert.throws(() => LookupItemSchema.parse({ maker: "only-maker" }));
  });

  it("rejects incomplete lookup request payloads", () => {
    assert.throws(() => LookupRequestSchema.parse({ items: [] }));
    assert.throws(() => LookupRequestSchema.parse({ items: [{}] }));
    assert.throws(() =>
      LookupRequestSchema.parse({ items: [{ source: "dlsite" }] }),
    );
  });
});

describe("shared API endpoint schemas", () => {
  it("parses lookup request/response", () => {
    const req = LookupRequestSchema.parse({
      items: [{ source: "dlsite", cid: "RJ000001", title: "t", maker: "m" }],
    });
    assert.equal(req.items.length, 1);

    const res = LookupResponseSchema.parse({
      results: [
        {
          owned: false,
          other: [
            {
              source: "fanza_doujin",
              cid: "d_1",
              title: "other",
              url: "https://example.com/item",
            },
          ],
        },
      ],
    });
    assert.equal(res.results[0]?.other.length, 1);

    const owned = LookupResponseSchema.parse({
      results: [{ owned: true, purchasedAt: "2023-12-30", other: [] }],
    });
    assert.equal(owned.results[0]?.purchasedAt, "2023-12-30");

    const ownedNullDate = LookupResponseSchema.parse({
      results: [{ owned: true, purchasedAt: null, other: [] }],
    });
    assert.equal(ownedNullDate.results[0]?.purchasedAt, null);
  });

  it("validates POST /api/import/:source path and body", () => {
    assert.equal(SourcePathSchema.parse({ source: "dlsite" }).source, "dlsite");
    assert.throws(() => SourcePathSchema.parse({ source: "unknown" }));

    const obj = ImportRequestSchema.parse({ works: [{ id: 1 }], page: 0 });
    assert.ok(obj && !Array.isArray(obj));

    const arr = ImportRequestSchema.parse([{ workno: "RJ1" }]);
    assert.ok(Array.isArray(arr));

    assert.throws(() => ImportRequestSchema.parse({}));
    assert.throws(() => ImportRequestSchema.parse([]));
    assert.throws(() => ImportRequestSchema.parse("raw-string"));

    const res = ImportResponseSchema.parse({ inserted: 1, updated: 2 });
    assert.equal(res.inserted + res.updated, 3);
  });

  it("validates GET /api/sync-state/:source response", () => {
    const res = SyncStateResponseSchema.parse({
      cursor: "123",
      lastSyncedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.equal(res.cursor, "123");
    assert.throws(() =>
      SyncStateResponseSchema.parse({ cursor: "x", lastSyncedAt: "not-a-date" }),
    );
  });

  it("validates candidates list/decision contracts", () => {
    CandidatesQuerySchema.parse({});
    CandidatesQuerySchema.parse({ limit: "10" });

    const list = CandidatesResponseSchema.parse({
      candidates: [
        {
          id: 1,
          a: { source: "dlsite", cid: "RJ1", title: "A" },
          b: { source: "fanza_doujin", cid: "d_1", title: "B" },
          dice: 0.85,
        },
      ],
    });
    assert.equal(list.candidates.length, 1);

    assert.equal(CandidateIdPathSchema.parse({ id: "42" }).id, 42);
    assert.throws(() => CandidateIdPathSchema.parse({ id: 0 }));

    assert.equal(CandidateDecisionSchema.parse({ same: true }).same, true);
    EmptyResponseSchema.parse({});
    assert.throws(() => EmptyResponseSchema.parse({ extra: true }));
  });

  it("validates rematch empty request and response", () => {
    RematchRequestSchema.parse({});
    EmptyRequestSchema.parse({});
    assert.throws(() => RematchRequestSchema.parse({ extra: 1 }));

    const res = RematchResponseSchema.parse({ rematched: 3, candidates: 1 });
    assert.equal(res.rematched, 3);
  });

  it("validates GET /api/listings query and response", () => {
    const query = ListingsQuerySchema.parse({
      q: "作品",
      source: "dlsite",
      limit: "20",
      offset: "0",
    });
    assert.equal(query.limit, 20);
    assert.equal(query.offset, 0);

    const listing = ListingSchema.parse({
      id: 1,
      source: "dlsite",
      cid: "RJ000001",
      workId: 10,
      title: "作品",
      maker: null,
      imageUrl: null,
      purchasedAt: null,
    });
    assert.equal(listing.cid, "RJ000001");

    const res = ListingsResponseSchema.parse({
      listings: [listing],
      total: 1,
    });
    assert.equal(res.listings.length, 1);

    assert.throws(() =>
      ListingsResponseSchema.parse({
        listings: [{ id: 1, source: "dlsite", cid: "", workId: 1, title: "t" }],
      }),
    );
  });

  it("validates manual listing and work assignment contracts", () => {
    ManualListingRequestSchema.parse({
      url: "https://www.dlsite.com/maniax/work/=/product_id/RJ000001.html",
    });
    assert.throws(() => ManualListingRequestSchema.parse({ url: "not-a-url" }));

    ManualListingResponseSchema.parse({
      listing: {
        id: 2,
        source: "dlsite",
        cid: "RJ000001",
        workId: 9,
        title: "manual",
      },
    });

    const path = ListingWorkPathSchema.parse({
      source: "fanza_books",
      cid: "b100",
    });
    assert.equal(path.source, "fanza_books");
    assert.throws(() =>
      ListingWorkPathSchema.parse({ source: "dlsite", cid: "" }),
    );

    WorkAssignmentRequestSchema.parse({ workId: 3, lock: true });
    assert.throws(() => WorkAssignmentRequestSchema.parse({ workId: 0 }));

    const assigned = WorkAssignmentResponseSchema.parse({
      workId: 3,
      locked: true,
    });
    assert.equal(assigned.locked, true);
  });

  it("validates export request/response", () => {
    ExportRequestSchema.parse({ destination: "/tmp/export" });
    assert.throws(() => ExportRequestSchema.parse({ destination: "" }));

    const res = ExportResponseSchema.parse({ path: "/tmp/export/adp-export.sqlite" });
    assert.match(res.path, /adp-export\.sqlite$/);
  });
});
