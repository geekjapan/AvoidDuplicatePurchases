import {
  MSG_AMAZON_READ_PAGE,
  type AmazonBooksPageReply,
} from "../messages.js";
import {
  importAmazonOnServer,
  type AmazonImportCounts,
} from "./server-client.js";

type AmazonBooksPage = Extract<AmazonBooksPageReply, { ok: true }>;

export interface AmazonSyncOutcome {
  ok: boolean;
  observed: number;
  stored: number;
  acquiredOrUnknown: number;
  rentals: number;
  error?: string;
}

export interface AmazonSyncDeps {
  getActiveTab?: () => Promise<{ id?: number } | null>;
  readPage?: (tabId: number) => Promise<AmazonBooksPageReply | null>;
  importPage?: (
    page: AmazonBooksPage,
  ) => Promise<{ ok: true; counts: AmazonImportCounts } | { ok: false; error: string }>;
}

const emptyCounts = {
  observed: 0,
  stored: 0,
  acquiredOrUnknown: 0,
  rentals: 0,
};

async function getActiveTab(): Promise<{ id?: number } | null> {
  return (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0] ?? null;
}

async function readPage(tabId: number): Promise<AmazonBooksPageReply | null> {
  try {
    return ((await chrome.tabs.sendMessage(tabId, { type: MSG_AMAZON_READ_PAGE })) ??
      null) as AmazonBooksPageReply | null;
  } catch {
    return null;
  }
}

export async function runAmazonManualSync(
  deps: AmazonSyncDeps = {},
): Promise<AmazonSyncOutcome> {
  const tab = await (deps.getActiveTab ?? getActiveTab)();
  if (!tab?.id) return { ok: false, ...emptyCounts, error: "amazon_page_required" };

  const page = await (deps.readPage ?? readPage)(tab.id);
  if (!page?.ok) return { ok: false, ...emptyCounts, error: "amazon_page_required" };

  const imported = await (deps.importPage ?? importAmazonOnServer)(page);
  if (!imported.ok) {
    return { ok: false, ...emptyCounts, observed: page.items.length, error: imported.error };
  }
  return { ok: true, ...imported.counts };
}
