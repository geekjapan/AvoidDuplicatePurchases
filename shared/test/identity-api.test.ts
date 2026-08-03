import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ImportResponseSchema,
  LookupRequestSchema,
  LookupResponseSchema,
} from "../src/api.js";
import { makeProductIdentity, normalizeCid, productKey } from "../src/identity.js";

describe("identity", () => {
  it("normalizes dlsite worknos to uppercase", () => {
    assert.equal(normalizeCid("dlsite", "rj123456"), "RJ123456");
    assert.equal(normalizeCid("fanza_doujin", "d_123"), "d_123");
  });

  it("productKey and makeProductIdentity", () => {
    const id = makeProductIdentity("dlsite", "rj000001");
    assert.equal(productKey(id), "dlsite:RJ000001");
    assert.throws(() => makeProductIdentity("dlsite", "   "), /empty cid/);
  });
});

describe("api schemas", () => {
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
  });

  it("parses import response", () => {
    const res = ImportResponseSchema.parse({ inserted: 1, updated: 2 });
    assert.equal(res.inserted + res.updated, 3);
  });
});
