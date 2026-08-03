import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  executeDryRun,
  verifyAllDryRun,
  verifySiteDryRun,
} from "../harness.js";

describe("cart-verify-harness", () => {
  it("dlsite delete uses per-cid GET loop with mode/nothanks", () => {
    const r = verifySiteDryRun("dlsite", "delete", 3);
    assert.equal(r.requestCount, 3);
    assert.equal(r.passed, true);
    assert.ok(r.checks.some((c) => c.name === "per-cid GET loop" && c.passed));
    assert.ok(r.checks.some((c) => c.name.includes("mode/nothanks") && c.passed));
    assert.ok(
      r.redactedRequests.every((req) =>
        req.pathPattern.includes("product_id/<REDACTED>"),
      ),
    );
  });

  it("dlsite restore uses per-cid GET loop with mode/cart", () => {
    const r = verifySiteDryRun("dlsite", "restore", 2);
    assert.equal(r.requestCount, 2);
    assert.equal(r.passed, true);
    assert.ok(r.checks.some((c) => c.name.includes("mode/cart") && c.passed));
  });

  it("fanza-doujin delete batches with _token", () => {
    const r = verifySiteDryRun("fanza-doujin", "delete");
    assert.equal(r.requestCount, 1);
    assert.equal(r.passed, true);
    assert.ok(r.checks.some((c) => c.name === "_token in body" && c.passed));
    assert.ok(
      r.redactedRequests[0]?.bodyShape?.includes("<REDACTED>"),
    );
  });

  it("fanza-doujin restore loops POST with _token", () => {
    const r = verifySiteDryRun("fanza-doujin", "restore");
    assert.equal(r.passed, true);
    assert.ok(
      r.checks.some((c) => c.name === "per-cid restore POST loop" && c.passed),
    );
  });

  it("fanza-books delete includes own_url without CSRF", () => {
    const r = verifySiteDryRun("fanza-books", "delete");
    assert.equal(r.requestCount, 1);
    assert.equal(r.passed, true);
    assert.ok(r.checks.some((c) => c.name === "own_url in body" && c.passed));
    assert.ok(r.checks.some((c) => c.name === "no CSRF _token" && c.passed));
  });

  it("fanza-books restore includes own_url", () => {
    const r = verifySiteDryRun("fanza-books", "restore");
    assert.equal(r.passed, true);
    assert.ok(r.checks.some((c) => c.name === "own_url in body" && c.passed));
  });

  it("verifyAllDryRun covers all three sites delete and restore", () => {
    const results = verifyAllDryRun();
    assert.equal(results.length, 6);
    assert.ok(results.every((r) => r.passed));
  });

  it("executeDryRun reports zero network requests", async () => {
    const results = verifyAllDryRun();
    const out = await executeDryRun(results);
    assert.equal(out.ok, true);
    assert.match(out.summary, /0 network requests/);
  });

  it("redacted output never contains placeholder token literal", () => {
    const results = verifyAllDryRun();
    const serialized = JSON.stringify(results);
    assert.ok(!serialized.includes("DRY_RUN_CSRF_PLACEHOLDER"));
    assert.ok(!serialized.includes("RJ000000"));
    assert.ok(!serialized.includes("d_000000"));
  });
});
