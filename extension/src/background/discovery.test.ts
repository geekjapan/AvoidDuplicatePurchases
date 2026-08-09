import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  discoverySessionCountForTests,
  resetDiscoverySessionsForTests,
  runDiscoverySelect,
  runDiscoveryStart,
  type DiscoveryDeps,
} from "./discovery.js";
import type {
  DiscoveryCandidate,
  DiscoveryProductReply,
  DiscoverySearchReply,
  DiscoveryStartMessage,
} from "../messages.js";
import { MSG_DISCOVERY_RESULT, MSG_PRICE_OBSERVATION } from "../messages.js";

const ORIGIN_TIERS = {
  regular: { amountMinor: 1100, currency: "JPY", taxStatus: "included" as const },
  sale: null,
  coupon: null,
};

function baseStart(over: Partial<DiscoveryStartMessage> = {}): DiscoveryStartMessage {
  return {
    type: "adp:discovery-start",
    sessionId: "sess-1",
    source: "fanza_doujin",
    cid: "d_origin",
    title: "フォレスティア",
    maker: "サークル森",
    pageUrl: "https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_origin/",
    originTiers: ORIGIN_TIERS,
    ...over,
  };
}

function exactCandidate(): DiscoveryCandidate {
  return {
    targetSource: "dlsite",
    cid: "RJ012345",
    title: "フォレスティア",
    maker: "サークル森",
    productUrl: "https://www.dlsite.com/maniax/work/=/product_id/RJ012345.html",
    rank: 1,
  };
}

function readySearch(candidates: DiscoveryCandidate[]): DiscoverySearchReply {
  return {
    ok: true,
    state: "ready",
    pageUrl: "https://www.dlsite.com/maniax/fsr/=/keyword/x/",
    candidates,
  };
}

function readyProduct(
  over: Partial<Extract<DiscoveryProductReply, { state: "ready" }>> = {},
): DiscoveryProductReply {
  return {
    ok: true,
    state: "ready",
    pageUrl: "https://www.dlsite.com/maniax/work/=/product_id/RJ012345.html",
    cid: "RJ012345",
    title: "フォレスティア",
    maker: "サークル森",
    tiers: {
      regular: { amountMinor: 990, currency: "JPY", taxStatus: "included" },
      sale: null,
      coupon: null,
    },
    ...over,
  };
}

function depsWith(partial: Partial<DiscoveryDeps> = {}): DiscoveryDeps {
  const closed: number[] = [];
  return {
    createTempTab: async () => 42,
    navigateTab: async () => {},
    closeTab: async (id) => {
      closed.push(id);
    },
    readSearch: async () => readySearch([exactCandidate()]),
    readProduct: async () => readyProduct(),
    notifyOrigin: async () => {},
    pollIntervalMs: 1,
    readinessTimeoutMs: 50,
    ...partial,
    // expose closed for assertions via partial override if needed
  };
}

describe("background discovery orchestrator", () => {
  it("unique_exact auto-opens product, returns compare, closes temp tab", async () => {
    resetDiscoverySessionsForTests();
    const closed: number[] = [];
    const notified: unknown[] = [];
    const created: string[] = [];

    const reply = await runDiscoveryStart(baseStart(), 7, {
      ...depsWith(),
      createTempTab: async (url) => {
        created.push(url);
        return 42;
      },
      closeTab: async (id) => {
        closed.push(id);
      },
      notifyOrigin: async (_tabId, message) => {
        notified.push(message);
      },
      readSearch: async () => readySearch([exactCandidate()]),
      readProduct: async () => readyProduct(),
    });

    assert.equal(reply.ok, true);
    // allow async orchestration to finish
    await new Promise((r) => setTimeout(r, 30));

    assert.ok(created[0]?.includes("dlsite.com/maniax/fsr"));
    const results = notified.filter(
      (m) => (m as { type?: string }).type === MSG_DISCOVERY_RESULT,
    );
    assert.equal(results.length, 1);
    const result = results[0] as {
      ok: true;
      kind: string;
      targetCid: string;
      targetTiers: { regular: { amountMinor: number } | null };
    };
    assert.equal(result.ok, true);
    assert.equal(result.kind, "compare");
    assert.equal(result.targetCid, "RJ012345");
    assert.equal(result.targetTiers.regular?.amountMinor, 990);
    assert.ok(closed.includes(42));
    assert.equal(discoverySessionCountForTests(), 0);
  });

  it("ambiguous candidates show picker and do not auto-open product", async () => {
    resetDiscoverySessionsForTests();
    const notified: unknown[] = [];
    let productReads = 0;

    await runDiscoveryStart(
      baseStart({ sessionId: "sess-amb" }),
      7,
      {
        ...depsWith(),
        notifyOrigin: async (_t, m) => {
          notified.push(m);
        },
        readSearch: async () =>
          readySearch([
            {
              ...exactCandidate(),
              cid: "RJ1",
              productUrl: "https://www.dlsite.com/maniax/work/=/product_id/RJ012345.html",
            },
            {
              ...exactCandidate(),
              cid: "RJ2",
              title: "フォレスティア",
              maker: "サークル森",
              productUrl: "https://www.dlsite.com/maniax/work/=/product_id/RJ012346.html",
            },
          ]),
        readProduct: async () => {
          productReads++;
          return readyProduct();
        },
      },
    );
    await new Promise((r) => setTimeout(r, 30));

    const results = notified.filter(
      (m) => (m as { type?: string }).type === MSG_DISCOVERY_RESULT,
    ) as Array<{ kind?: string; candidates?: unknown[] }>;
    assert.equal(results.length, 1);
    assert.equal(results[0]!.kind, "candidates");
    assert.equal(results[0]!.candidates?.length, 2);
    assert.equal(productReads, 0);
    assert.equal(discoverySessionCountForTests(), 1);
  });

  it("user select opens product after candidates", async () => {
    resetDiscoverySessionsForTests();
    const notified: unknown[] = [];
    await runDiscoveryStart(
      baseStart({ sessionId: "sess-sel", maker: null, title: "フォレスティア" }),
      7,
      {
        ...depsWith(),
        notifyOrigin: async (_t, m) => {
          notified.push(m);
        },
        readSearch: async () => readySearch([exactCandidate()]),
      },
    );
    await new Promise((r) => setTimeout(r, 20));

    // maker null → candidates path
    const selectReply = await runDiscoverySelect(
      {
        type: "adp:discovery-select-candidate",
        sessionId: "sess-sel",
        productUrl: exactCandidate().productUrl,
        targetSource: "dlsite",
        cid: "RJ012345",
      },
      7,
      {
        ...depsWith(),
        notifyOrigin: async (_t, m) => {
          notified.push(m);
        },
        readProduct: async () => readyProduct(),
      },
    );
    assert.equal(selectReply.ok, true);
    await new Promise((r) => setTimeout(r, 30));

    const compares = notified.filter(
      (m) =>
        (m as { type?: string; kind?: string }).type === MSG_DISCOVERY_RESULT &&
        (m as { kind?: string }).kind === "compare",
    );
    assert.equal(compares.length, 1);
  });

  it("age_gate and login fail closed", async () => {
    resetDiscoverySessionsForTests();
    const notified: unknown[] = [];
    await runDiscoveryStart(baseStart({ sessionId: "sess-age" }), 7, {
      ...depsWith(),
      notifyOrigin: async (_t, m) => {
        notified.push(m);
      },
      readSearch: async () => ({
        ok: true,
        state: "age_gate",
        pageUrl: "https://www.dmm.co.jp/age_check/",
      }),
    });
    await new Promise((r) => setTimeout(r, 20));
    const fail = notified.find(
      (m) =>
        (m as { type?: string; ok?: boolean }).type === MSG_DISCOVERY_RESULT &&
        (m as { ok?: boolean }).ok === false,
    ) as { failureCode?: string } | undefined;
    assert.equal(fail?.failureCode, "discovery_age_gate");
  });

  it("product cid mismatch fails closed", async () => {
    resetDiscoverySessionsForTests();
    const notified: unknown[] = [];
    await runDiscoveryStart(baseStart({ sessionId: "sess-mm" }), 7, {
      ...depsWith(),
      notifyOrigin: async (_t, m) => {
        notified.push(m);
      },
      readSearch: async () => readySearch([exactCandidate()]),
      readProduct: async () => ({
        ok: true,
        state: "mismatch",
        pageUrl: "https://www.dlsite.com/maniax/work/=/product_id/RJ000000.html",
        cid: "RJ000000",
      }),
    });
    await new Promise((r) => setTimeout(r, 30));
    const fail = notified.find(
      (m) =>
        (m as { type?: string; ok?: boolean }).type === MSG_DISCOVERY_RESULT &&
        (m as { ok?: boolean }).ok === false,
    ) as { failureCode?: string } | undefined;
    assert.equal(fail?.failureCode, "discovery_product_mismatch");
  });

  it("never posts price observation messages", async () => {
    resetDiscoverySessionsForTests();
    const notified: unknown[] = [];
    await runDiscoveryStart(baseStart({ sessionId: "sess-po" }), 7, {
      ...depsWith(),
      notifyOrigin: async (_t, m) => {
        notified.push(m);
      },
    });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(
      notified.some((m) => (m as { type?: string }).type === MSG_PRICE_OBSERVATION),
      false,
    );
  });

  it("rejects invalid start payloads", async () => {
    const reply = await runDiscoveryStart(
      { ...baseStart(), title: "" } as DiscoveryStartMessage,
      7,
      depsWith(),
    );
    assert.equal(reply.ok, false);
  });

  it("timeout when search stays page_not_ready", async () => {
    resetDiscoverySessionsForTests();
    const notified: unknown[] = [];
    await runDiscoveryStart(baseStart({ sessionId: "sess-to" }), 7, {
      ...depsWith(),
      readinessTimeoutMs: 15,
      pollIntervalMs: 5,
      notifyOrigin: async (_t, m) => {
        notified.push(m);
      },
      readSearch: async () => ({
        ok: true,
        state: "page_not_ready",
        pageUrl: "https://www.dlsite.com/maniax/fsr/",
      }),
    });
    await new Promise((r) => setTimeout(r, 40));
    const fail = notified.find(
      (m) =>
        (m as { type?: string; ok?: boolean }).type === MSG_DISCOVERY_RESULT &&
        (m as { ok?: boolean }).ok === false,
    ) as { failureCode?: string } | undefined;
    assert.equal(fail?.failureCode, "discovery_search_timeout");
  });
});
