import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MarketOfferPriceSchema,
  RelationEvidenceSchema,
  RelatedImportRequestSchema,
  RelatedProductsQuerySchema,
  RelatedProductsResponseSchema,
} from "../src/index.js";

const money = {
  amountMinor: 1100,
  currency: "JPY",
  taxStatus: "included" as const,
};

describe("RelationEvidenceSchema", () => {
  it("accepts maker/author/series/store_related only", () => {
    for (const kind of ["maker", "author", "series", "store_related"] as const) {
      const origin = kind === "store_related" ? ("store" as const) : ("derived" as const);
      const parsed = RelationEvidenceSchema.parse({
        kind,
        origin,
        anchorValue: "サークルA",
        productValue: "サークルA",
      });
      assert.equal(parsed.kind, kind);
    }
  });

  it("rejects title similarity and unknown kinds", () => {
    assert.throws(() =>
      RelationEvidenceSchema.parse({
        kind: "title_similarity",
        origin: "derived",
        anchorValue: "foo",
        productValue: "bar",
      }),
    );
    assert.throws(() =>
      RelationEvidenceSchema.parse({
        kind: "title",
        origin: "derived",
        anchorValue: null,
        productValue: null,
      }),
    );
  });

  it("requires store origin for store_related", () => {
    assert.throws(() =>
      RelationEvidenceSchema.parse({
        kind: "store_related",
        origin: "derived",
        anchorValue: null,
        productValue: "おすすめ",
      }),
    );
  });
});

describe("MarketOfferPriceSchema", () => {
  it("keeps currency/taxStatus/observedAt and explicit freshness", () => {
    const price = MarketOfferPriceSchema.parse({
      current: money,
      regular: { ...money, amountMinor: 2200 },
      discountPercent: 50,
      saleEndsAt: "2026-08-15T15:00:00.000Z",
      observedAt: "2026-08-09T00:00:00.000Z",
      freshness: "fresh",
    });
    assert.equal(price.current?.taxStatus, "included");
    assert.equal(price.freshness, "fresh");
  });

  it("allows null price fields with unavailable freshness", () => {
    const price = MarketOfferPriceSchema.parse({
      current: null,
      regular: null,
      discountPercent: null,
      saleEndsAt: null,
      observedAt: null,
      freshness: "unavailable",
    });
    assert.equal(price.freshness, "unavailable");
  });

  it("rejects invented floating discount precision beyond 2 decimals", () => {
    assert.throws(() =>
      MarketOfferPriceSchema.parse({
        current: money,
        regular: null,
        discountPercent: 12.345,
        saleEndsAt: null,
        observedAt: "2026-08-09T00:00:00.000Z",
        freshness: "fresh",
      }),
    );
  });
});

describe("RelatedImportRequestSchema synthetic contract", () => {
  it("accepts synthetic_related_v1 only", () => {
    const req = RelatedImportRequestSchema.parse({
      contract: "synthetic_related_v1",
      anchor: { source: "dlsite", cid: "RJ000001" },
      complete: true,
      items: [
        {
          product: {
            source: "dlsite",
            cid: "RJ000099",
            title: "関連作品",
            maker: "サークルA",
            seriesId: null,
            imageUrl: null,
            productUrl: "https://www.dlsite.com/maniax/work/=/product_id/RJ000099.html",
          },
          evidence: [
            {
              kind: "maker",
              origin: "derived",
              anchorValue: "サークルA",
              productValue: "サークルA",
            },
          ],
          price: {
            current: money,
            regular: { ...money, amountMinor: 2200 },
            discountPercent: 50,
            saleEndsAt: null,
          },
          availability: "available",
        },
      ],
    });
    assert.equal(req.contract, "synthetic_related_v1");
    assert.equal(req.items.length, 1);
  });

  it("rejects raw store-shaped payloads without the synthetic contract marker", () => {
    assert.throws(() =>
      RelatedImportRequestSchema.parse({
        anchor: { source: "dlsite", cid: "RJ000001" },
        payload: { works: [] },
        complete: true,
      }),
    );
    assert.throws(() =>
      RelatedImportRequestSchema.parse({
        contract: "dlsite_related_raw_v1",
        anchor: { source: "dlsite", cid: "RJ000001" },
        complete: true,
        items: [],
      }),
    );
  });
});

describe("RelatedProducts query/response", () => {
  it("requires anchor identity and validates owned/sort enums", () => {
    const q = RelatedProductsQuerySchema.parse({
      anchorSource: "dlsite",
      anchorCid: "RJ000001",
      owned: "mark",
      sort: "price_asc",
      currency: "JPY",
    });
    assert.equal(q.anchorSource, "dlsite");
    assert.throws(() =>
      RelatedProductsQuerySchema.parse({
        anchorSource: "dlsite",
        anchorCid: "RJ000001",
        owned: "hide",
      }),
    );
    assert.throws(() =>
      RelatedProductsQuerySchema.parse({
        anchorSource: "dlsite",
        anchorCid: "RJ000001",
        sort: "title_similarity",
      }),
    );
  });

  it("parses a full response shape", () => {
    const res = RelatedProductsResponseSchema.parse({
      anchor: { source: "dlsite", cid: "RJ000001" },
      generatedAt: "2026-08-09T12:00:00.000Z",
      items: [
        {
          product: {
            source: "fanza_doujin",
            cid: "d_rel_1",
            title: "関連",
            maker: "Maker",
            seriesId: null,
            imageUrl: null,
            productUrl: null,
          },
          relation: {
            evidence: [
              {
                kind: "series",
                origin: "store",
                anchorValue: "series-1",
                productValue: "series-1",
              },
            ],
          },
          ownership: {
            status: "not_confirmed",
            matchedBy: null,
            ownedBy: [],
          },
          price: {
            current: money,
            regular: null,
            discountPercent: null,
            saleEndsAt: null,
            observedAt: "2026-08-09T11:00:00.000Z",
            freshness: "fresh",
          },
        },
      ],
      total: 1,
      warnings: [{ source: "fanza_video", code: "unsupported" }],
    });
    assert.equal(res.items[0]?.ownership.status, "not_confirmed");
  });
});
