#!/usr/bin/env node
/**
 * Cart verification harness — dry-run only.
 * Builds delete/restore requests via @adp/shared and validates contracts.
 * NEVER sends network requests (no fetch, no live cart mutation).
 */
import { z } from "zod";

import { ALL_SITES } from "./fixtures.js";
import {
  executeDryRun,
  verifyAllDryRun,
  verifySiteDryRun,
  type CartAction,
} from "./harness.js";
import type { CartSource } from "@adp/shared";

const siteSchema = z.enum(["dlsite", "fanza-doujin", "fanza-books"]);
const actionSchema = z.enum(["delete", "restore"]);

const cliArgsSchema = z
  .object({
    dryRun: z.literal(true, {
      error: "--dry-run is required (live cart mutation is not supported)",
    }),
    site: siteSchema.optional(),
    action: actionSchema.optional(),
  })
  .strict();

export type ParsedCliArgs = z.infer<typeof cliArgsSchema>;

/**
 * Parse argv into a validated options object.
 * Unknown flags and incomplete option values are rejected.
 */
export function parseArgs(argv: string[]): ParsedCliArgs {
  const raw: {
    dryRun?: true;
    site?: string;
    action?: string;
  } = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) break;

    if (token === "--dry-run") {
      raw.dryRun = true;
      continue;
    }

    if (token === "--site") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("error: --site requires a value");
      }
      raw.site = value;
      i++;
      continue;
    }

    if (token === "--action") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("error: --action requires a value");
      }
      raw.action = value;
      i++;
      continue;
    }

    if (token.startsWith("--")) {
      throw new Error(`error: unknown option ${token}`);
    }

    throw new Error(`error: unexpected argument ${token}`);
  }

  const result = cliArgsSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path[0];
    if (path === "dryRun") {
      throw new Error(
        "error: --dry-run is required (live cart mutation is not supported)",
      );
    }
    if (path === "site") {
      throw new Error(
        `error: unknown site ${String(raw.site)} (expected ${ALL_SITES.join("|")})`,
      );
    }
    if (path === "action") {
      throw new Error(
        `error: unknown action ${String(raw.action)} (expected delete|restore)`,
      );
    }
    const msg = first?.message ?? "invalid arguments";
    throw new Error(msg.startsWith("error:") ? msg : `error: ${msg}`);
  }
  return result.data;
}

export function selectResults(
  site: CartSource | undefined,
  action: CartAction | undefined,
) {
  if (site && action) {
    return [verifySiteDryRun(site, action)];
  }
  if (site) {
    return [
      verifySiteDryRun(site, "delete"),
      verifySiteDryRun(site, "restore"),
    ];
  }
  if (action) {
    return verifyAllDryRun(action);
  }
  return verifyAllDryRun();
}

function usage(): void {
  console.error(`Usage: cart-verify --dry-run [--site ${ALL_SITES.join("|")}] [--action delete|restore]

Dry-run only. Validates cart delete/restore request contracts without network I/O.
`);
}

async function main(): Promise<void> {
  let parsed: ParsedCliArgs;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    usage();
    process.exit(2);
  }

  const results = selectResults(parsed.site, parsed.action);

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

const isDirectRun =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("/cli.ts") ||
    process.argv[1].endsWith("\\cli.ts") ||
    process.argv[1].endsWith("/cli.js") ||
    process.argv[1].endsWith("\\cli.js"));

if (isDirectRun) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
