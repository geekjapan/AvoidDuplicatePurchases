import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { parseArgs, selectResults } from "../cli.js";
import {
  executeDryRun,
  verifyAllDryRun,
  verifySiteDryRun,
} from "../harness.js";

const cliPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../cli.ts",
);

function runCli(args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", cliPath, ...args],
    {
      encoding: "utf8",
      env: process.env,
    },
  );
}

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
    assert.ok(
      !r.checks.some((c) => c.name === "per-cid restore POST loop"),
      "delete must not emit restore-only checks",
    );
  });

  it("fanza-doujin restore loops POST with _token", () => {
    const r = verifySiteDryRun("fanza-doujin", "restore");
    assert.equal(r.requestCount, 2);
    assert.equal(r.passed, true);
    assert.ok(
      r.checks.some((c) => c.name === "per-cid restore POST loop" && c.passed),
    );
    assert.ok(
      !r.checks.some((c) => c.name === "single batched delete request"),
      "restore must not emit delete-only checks",
    );
  });

  it("fanza-doujin restore honors non-default cidCount", () => {
    const r = verifySiteDryRun("fanza-doujin", "restore", 3);
    assert.equal(r.requestCount, 3);
    assert.equal(r.passed, true);
    assert.ok(
      r.checks.some((c) => c.name === "per-cid restore POST loop" && c.passed),
    );
  });

  it("fanza-doujin delete ignores cidCount for batch shape", () => {
    const r = verifySiteDryRun("fanza-doujin", "delete", 3);
    assert.equal(r.requestCount, 1);
    assert.equal(r.passed, true);
    assert.ok(
      r.checks.some((c) => c.name === "single batched delete request" && c.passed),
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

  it("verifyAllDryRun can filter by action", () => {
    const results = verifyAllDryRun("delete");
    assert.equal(results.length, 3);
    assert.ok(results.every((r) => r.action === "delete" && r.passed));
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

describe("cart-verify CLI argv", () => {
  it("requires --dry-run", () => {
    assert.throws(() => parseArgs([]), /--dry-run is required/);
  });

  it("rejects unknown options", () => {
    assert.throws(
      () => parseArgs(["--dry-run", "--live"]),
      /unknown option --live/,
    );
  });

  it("rejects incomplete --site / --action", () => {
    assert.throws(() => parseArgs(["--dry-run", "--site"]), /--site requires/);
    assert.throws(
      () => parseArgs(["--dry-run", "--action"]),
      /--action requires/,
    );
  });

  it("rejects invalid enum values", () => {
    assert.throws(
      () => parseArgs(["--dry-run", "--site", "amazon"]),
      /unknown site/,
    );
    assert.throws(
      () => parseArgs(["--dry-run", "--action", "mutate"]),
      /unknown action/,
    );
  });

  it("accepts valid combinations", () => {
    assert.deepEqual(parseArgs(["--dry-run"]), { dryRun: true });
    assert.deepEqual(parseArgs(["--dry-run", "--action", "delete"]), {
      dryRun: true,
      action: "delete",
    });
    assert.deepEqual(
      parseArgs(["--dry-run", "--site", "dlsite", "--action", "restore"]),
      { dryRun: true, site: "dlsite", action: "restore" },
    );
  });

  it("selectResults honors --action without --site", () => {
    const results = selectResults(undefined, "delete");
    assert.equal(results.length, 3);
    assert.ok(results.every((r) => r.action === "delete"));
  });

  it("selectResults honors --site with --action", () => {
    const results = selectResults("fanza-doujin", "restore");
    assert.equal(results.length, 1);
    assert.equal(results[0]?.site, "fanza-doujin");
    assert.equal(results[0]?.action, "restore");
  });
});

describe("cart-verify CLI process", () => {
  it("rejects invocation without --dry-run with exit code 2", () => {
    const r = runCli([]);
    assert.equal(r.status, 2, r.stderr || r.stdout);
    assert.match(r.stderr, /--dry-run is required/);
  });

  it("rejects unknown options at process level with exit code 2", () => {
    const r = runCli(["--dry-run", "--unknown-flag"]);
    assert.equal(r.status, 2, r.stderr || r.stdout);
    assert.match(r.stderr, /unknown option/);
  });

  it("succeeds with --dry-run (exit 0)", () => {
    const r = runCli(["--dry-run"]);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /dry-run ok/);
    assert.match(r.stdout, /0 network requests/);
  });

  it("honors --action delete without running restore", () => {
    const r = runCli(["--dry-run", "--action", "delete"]);
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /delete/);
    assert.doesNotMatch(r.stdout, / restore /);
    assert.match(r.stdout, /dry-run ok: 3 scenarios/);
  });
});
