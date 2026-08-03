#!/usr/bin/env node
/**
 * Cart verification harness — dry-run only.
 * Builds delete/restore requests via @adp/shared and validates contracts.
 * NEVER sends network requests (no fetch, no live cart mutation).
 */
import { type CartSource } from "@adp/shared";

import { ALL_SITES } from "./fixtures.js";
import {
  executeDryRun,
  verifyAllDryRun,
  verifySiteDryRun,
  type CartAction,
} from "./harness.js";

function parseArgs(argv: string[]): {
  dryRun: boolean;
  site?: CartSource;
  action?: CartAction;
} {
  const dryRun = argv.includes("--dry-run");
  let site: CartSource | undefined;
  let action: CartAction | undefined;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--site" && argv[i + 1]) {
      site = argv[i + 1] as CartSource;
      i++;
    }
    if (argv[i] === "--action" && argv[i + 1]) {
      action = argv[i + 1] as CartAction;
      i++;
    }
  }

  return { dryRun, site, action };
}

function usage(): void {
  console.error(`Usage: cart-verify --dry-run [--site ${ALL_SITES.join("|")}] [--action delete|restore]

Dry-run only. Validates cart delete/restore request contracts without network I/O.
`);
}

async function main(): Promise<void> {
  const { dryRun, site, action } = parseArgs(process.argv.slice(2));

  if (!dryRun) {
    console.error("error: --dry-run is required (live cart mutation is not supported)");
    usage();
    process.exit(2);
  }

  if (site && !ALL_SITES.includes(site)) {
    console.error(`error: unknown site ${site}`);
    usage();
    process.exit(2);
  }

  if (action && action !== "delete" && action !== "restore") {
    console.error(`error: unknown action ${action}`);
    usage();
    process.exit(2);
  }

  let results;
  if (site && action) {
    results = [verifySiteDryRun(site, action)];
  } else if (site) {
    results = [
      verifySiteDryRun(site, "delete"),
      verifySiteDryRun(site, "restore"),
    ];
  } else {
    results = verifyAllDryRun();
  }

  for (const r of results) {
    const status = r.passed ? "PASS" : "FAIL";
    console.log(`[${status}] ${r.site} ${r.action} (${r.requestCount} requests)`);
    for (const c of r.checks) {
      console.log(`  - ${c.passed ? "ok" : "NG"}: ${c.name}`);
    }
    for (const req of r.redactedRequests) {
      console.log(
        `  > ${req.method} ${req.host}${req.pathPattern}${req.bodyShape ? ` body=${req.bodyShape}` : ""}`,
      );
    }
  }

  const { ok, summary } = await executeDryRun(results);
  console.log(summary);
  process.exit(ok ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
