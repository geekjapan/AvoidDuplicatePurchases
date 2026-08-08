import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runAmazonManualSync } from "./amazon-sync.js";

describe("Amazon manual sync", () => {
  it("reads one active tab and sends only its page result to the server seam", async () => {
    let readTab: number | null = null;
    const result = await runAmazonManualSync({
      getActiveTab: async () => ({ id: 7 }),
      readPage: async (tabId) => {
        readTab = tabId;
        return {
          ok: true,
          pageUrl:
            "https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll/dateDsc?pageNumber=1",
          pageNumber: 1,
          items: [
            {
              asin: "SYNTHETI01",
              title: "Synthetic book",
              author: "Synthetic author",
              acquiredLabel: "取得日: 2026年8月8日",
              isRental: false,
              isRead: false,
            },
          ],
        };
      },
      importPage: async (page) => {
        assert.equal(page.items.length, 1);
        return {
          ok: true,
          counts: { observed: 1, stored: 1, acquiredOrUnknown: 1, rentals: 0 },
        };
      },
    });

    assert.equal(readTab, 7);
    assert.deepEqual(result, {
      ok: true,
      observed: 1,
      stored: 1,
      acquiredOrUnknown: 1,
      rentals: 0,
    });
  });

  it("fails closed when the active tab is not the Amazon Books page", async () => {
    const result = await runAmazonManualSync({
      getActiveTab: async () => ({ id: 7 }),
      readPage: async () => ({ ok: false, error: "amazon_page_required" }),
      importPage: async () => {
        throw new Error("must not import");
      },
    });
    assert.deepEqual(result, {
      ok: false,
      observed: 0,
      stored: 0,
      acquiredOrUnknown: 0,
      rentals: 0,
      error: "amazon_page_required",
    });
  });
});
