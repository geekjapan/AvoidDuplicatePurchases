import {
  buildDeleteRequests,
  buildRestoreRequests,
  type CartRequest,
  type CartSource,
} from "@adp/shared";

import { ALL_SITES, DRY_RUN_CID, DRY_RUN_CTX } from "./fixtures.js";
import { redactRequest } from "./redact.js";

export type CartAction = "delete" | "restore";

export interface SiteCheck {
  name: string;
  passed: boolean;
}

export interface SiteVerifyResult {
  site: CartSource;
  action: CartAction;
  requestCount: number;
  checks: SiteCheck[];
  redactedRequests: ReturnType<typeof redactRequest>[];
  passed: boolean;
}

function buildRequests(
  site: CartSource,
  action: CartAction,
  cids: string[],
): CartRequest[] {
  const ctx = {
    csrfToken: DRY_RUN_CTX.csrfToken,
    ownUrl: DRY_RUN_CTX.ownUrl,
  };
  return action === "delete"
    ? buildDeleteRequests(site, cids, ctx)
    : buildRestoreRequests(site, cids, ctx);
}

function checkDlsiteLoop(
  requests: CartRequest[],
  action: CartAction,
  cidCount: number,
): SiteCheck[] {
  const mode = action === "delete" ? "mode/nothanks" : "mode/cart";
  return [
    {
      name: "per-cid GET loop",
      passed: requests.length === cidCount,
    },
    {
      name: `uses ${mode}`,
      passed: requests.every((r) => r.url.includes(mode) && r.method === "GET"),
    },
    {
      name: "no request body",
      passed: requests.every((r) => r.body === undefined),
    },
  ];
}

function checkDoujinToken(requests: CartRequest[], action: CartAction): SiteCheck[] {
  const checks: SiteCheck[] = [
    {
      name: "single batched delete request",
      passed:
        action === "delete"
          ? requests.length === 1 && requests[0]?.method === "DELETE"
          : true,
    },
    {
      name: "_token in body",
      passed: requests.every((r) => {
        if (!r.body) return false;
        const body = JSON.parse(r.body) as { _token?: string };
        return body._token === DRY_RUN_CTX.csrfToken;
      }),
    },
  ];
  if (action === "restore") {
    checks.push({
      name: "per-cid restore POST loop",
      passed:
        requests.length === 2 &&
        requests.every((r) => r.method === "POST"),
    });
  }
  return checks;
}

function checkBooksOwnUrl(requests: CartRequest[]): SiteCheck[] {
  return [
    {
      name: "single batched request",
      passed: requests.length === 1 && requests[0]?.method === "POST",
    },
    {
      name: "own_url in body",
      passed: requests.every((r) => {
        if (!r.body) return false;
        const body = JSON.parse(r.body) as { own_url?: string };
        return body.own_url === DRY_RUN_CTX.ownUrl;
      }),
    },
    {
      name: "no CSRF _token",
      passed: requests.every((r) => {
        if (!r.body) return true;
        const body = JSON.parse(r.body) as { _token?: string };
        return !("_token" in body);
      }),
    },
  ];
}

function runSiteChecks(
  site: CartSource,
  action: CartAction,
  requests: CartRequest[],
  cidCount: number,
): SiteCheck[] {
  switch (site) {
    case "dlsite":
      return checkDlsiteLoop(requests, action, cidCount);
    case "fanza-doujin":
      return checkDoujinToken(requests, action);
    case "fanza-books":
      return checkBooksOwnUrl(requests);
  }
}

export function verifySiteDryRun(
  site: CartSource,
  action: CartAction,
  cidCount = 2,
): SiteVerifyResult {
  const cids = Array.from({ length: cidCount }, (_, i) => {
    const base = DRY_RUN_CID[site];
    return i === 0 ? base : `${base}_${i}`;
  });

  const requests = buildRequests(site, action, cids);
  const checks = runSiteChecks(site, action, requests, cidCount);
  const passed = checks.every((c) => c.passed);

  return {
    site,
    action,
    requestCount: requests.length,
    checks,
    redactedRequests: requests.map(redactRequest),
    passed,
  };
}

export function verifyAllDryRun(): SiteVerifyResult[] {
  const results: SiteVerifyResult[] = [];
  for (const site of ALL_SITES) {
    results.push(verifySiteDryRun(site, "delete"));
    results.push(verifySiteDryRun(site, "restore"));
  }
  return results;
}

/** Dry-run only — never performs network I/O. */
export async function executeDryRun(
  results: SiteVerifyResult[],
): Promise<{ ok: boolean; summary: string }> {
  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    const names = failed.map((r) => `${r.site}/${r.action}`).join(", ");
    return { ok: false, summary: `failed: ${names}` };
  }
  return {
    ok: true,
    summary: `dry-run ok: ${results.length} scenarios, 0 network requests`,
  };
}
