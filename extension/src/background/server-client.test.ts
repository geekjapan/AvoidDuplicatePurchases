import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  PROTOCOL_ERROR,
  importLibraryBatchOnServer,
  markLibrarySourceSyncedOnServer,
  postPriceObservationOnServer,
} from "./server-client.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockJson(status: number, body: unknown): void {
  globalThis.fetch = (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response) as typeof fetch;
}

describe("server-client response schema validation", () => {
  it("rejects malformed library import 200 bodies as protocol errors", async () => {
    mockJson(200, { observed: 1, inserted: "nope" });
    const res = await importLibraryBatchOnServer(
      "amazon",
      "https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll/",
      [{ cid: "SYNTHETI01", title: "t", state: "purchased" }],
    );
    assert.deepEqual(res, { ok: false, error: PROTOCOL_ERROR });
  });

  it("accepts a well-formed library import response", async () => {
    const byState: Record<string, number> = {};
    for (const state of [
      "purchased",
      "free",
      "rental",
      "sample",
      "preview",
      "subscription",
      "gift",
      "reservation",
      "unknown",
    ]) {
      byState[state] = 0;
    }
    byState.purchased = 1;
    mockJson(200, {
      observed: 1,
      inserted: 1,
      updated: 0,
      byState,
    });
    const res = await importLibraryBatchOnServer(
      "amazon",
      "https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll/",
      [{ cid: "SYNTHETI01", title: "t", state: "purchased" }],
    );
    assert.deepEqual(res, {
      ok: true,
      counts: {
        observed: 1,
        inserted: 1,
        updated: 0,
        byState,
      },
    });
  });

  it("rejects partial byState and unknown response keys as protocol errors", async () => {
    const byState: Record<string, number> = {};
    for (const state of [
      "purchased",
      "free",
      "rental",
      "sample",
      "preview",
      "subscription",
      "gift",
      "reservation",
      "unknown",
    ]) {
      byState[state] = 0;
    }
    mockJson(200, { observed: 1, inserted: 1, updated: 0, byState: { purchased: 1 } });
    const partial = await importLibraryBatchOnServer(
      "amazon",
      "https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll/",
      [{ cid: "SYNTHETI01", title: "t", state: "purchased" }],
    );
    assert.deepEqual(partial, { ok: false, error: PROTOCOL_ERROR });

    mockJson(200, { observed: 1, inserted: 1, updated: 0, byState, extra: 1 });
    const extra = await importLibraryBatchOnServer(
      "amazon",
      "https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll/",
      [{ cid: "SYNTHETI01", title: "t", state: "purchased" }],
    );
    assert.deepEqual(extra, { ok: false, error: PROTOCOL_ERROR });
  });

  it("rejects malformed sync-state 200 bodies when marking synced", async () => {
    mockJson(200, { cursor: 12, lastSyncedAt: null });
    assert.equal(await markLibrarySourceSyncedOnServer("amazon"), false);
  });

  it("rejects malformed price-observation 200 bodies as protocol errors", async () => {
    mockJson(200, { ok: true });
    const res = await postPriceObservationOnServer({
      source: "dlsite",
      cid: "RJ000001",
      pageUrl: "https://www.dlsite.com/maniax/work/=/product_id/RJ000001.html",
      regular: { amountMinor: 1100, currency: "JPY", taxStatus: "unknown" },
      sale: null,
      coupon: null,
    });
    assert.deepEqual(res, { ok: false, error: PROTOCOL_ERROR });
  });

  it("accepts a well-formed price-observation response", async () => {
    mockJson(200, {
      ok: true,
      priceObservation: {
        regular: { amountMinor: 1100, currency: "JPY", taxStatus: "unknown" },
        sale: null,
        coupon: null,
        observedAt: "2026-08-08T00:00:00.000Z",
      },
    });
    const res = await postPriceObservationOnServer({
      source: "dlsite",
      cid: "RJ000001",
      pageUrl: "https://www.dlsite.com/maniax/work/=/product_id/RJ000001.html",
      regular: { amountMinor: 1100, currency: "JPY", taxStatus: "unknown" },
      sale: null,
      coupon: null,
    });
    assert.deepEqual(res, { ok: true });
  });
});
