import { doujinLibraryUrl } from "@adp/shared/adapters/fanza_doujin";
import {
  booksLibraryUrl,
  booksContentsUrl,
} from "@adp/shared/adapters/fanza_books";
import {
  VIDEO_GRAPHQL_URL,
  videoPurchasedGraphqlBody,
} from "@adp/shared/adapters/fanza_video";
import { dlsoftLibraryUrl } from "@adp/shared/adapters/fanza_dlsoft";
import {
  importFanzaOnServer,
  markFanzaSyncedOnServer,
  type FanzaImportResult,
  type ImportCounts,
} from "./server-api.js";

export interface SourceSyncOutcome {
  ok: boolean;
  counts?: ImportCounts;
  error?: string;
  fetched?: number;
}

async function fetchJson(url: string, init?: RequestInit): Promise<
  { ok: true; data: unknown } | { ok: false; error: string }
> {
  try {
    const res = await fetch(url, { credentials: "include", ...init });
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, error: "network" };
  }
}

const VIDEO_PAGE_MATCH = "https://video.dmm.co.jp/*";
const VIDEO_PAGE_URL = "https://video.dmm.co.jp/av/mylibrary/";
const VIDEO_PAGE_READY_TIMEOUT_MS = 10_000;

type VideoPageRequest = {
  method: string;
  headers: Record<string, string>;
  body?: string;
};

type VideoPageResponse = {
  ok: boolean;
  status: number;
  data?: unknown;
};

/** FANZA Video only allows the web-page Origin, so run this request in that page world. */
async function fetchVideoJsonInPage(
  url: string,
  init: VideoPageRequest,
): Promise<VideoPageResponse> {
  const res = await fetch(url, { ...init, credentials: "include" });
  return {
    ok: res.ok,
    status: res.status,
    data: res.ok ? await res.json() : undefined,
  };
}

async function waitForVideoPage(tabId: number): Promise<void> {
  const current = await chrome.tabs.get(tabId);
  if (current.status === "complete") return;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    let listener: (updatedTabId: number, changeInfo: { status?: string }) => void;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      if (error) reject(error);
      else resolve();
    };

    listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish();
    };

    timeout = setTimeout(
      () => finish(new Error("video_page_timeout")),
      VIDEO_PAGE_READY_TIMEOUT_MS,
    );
    chrome.tabs.onUpdated.addListener(listener);
    void chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === "complete") finish();
      })
      .catch(() => finish(new Error("video_page_unavailable")));
  });
}

async function fetchVideoJson(
  url: string,
  init: RequestInit,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  if (typeof chrome === "undefined") return fetchJson(url, init);

  try {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const tabs = await chrome.tabs.query({ url: VIDEO_PAGE_MATCH });
    const existing = tabs.find((candidate) => typeof candidate.id === "number");
    const temporary = existing?.id === undefined;
    const tab = existing ?? (await chrome.tabs.create({ url: VIDEO_PAGE_URL, active: false }));
    if (tab.id === undefined) return { ok: false, error: "video_page_unavailable" };

    try {
      await waitForVideoPage(tab.id);
      const [injected] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: fetchVideoJsonInPage,
        args: [
          url,
          {
            method: init.method ?? "GET",
            headers,
            body: typeof init.body === "string" ? init.body : undefined,
          },
        ],
      });
      const result = injected?.result as VideoPageResponse | undefined;
      if (!result) return { ok: false, error: "network" };
      if (!result.ok) return { ok: false, error: `http_${result.status}` };
      return { ok: true, data: result.data };
    } finally {
      if (temporary) await chrome.tabs.remove(tab.id).catch(() => {});
    }
  } catch {
    return { ok: false, error: "network" };
  }
}

type PageMeta = {
  itemCount: number;
  totalCount: number;
  hasNext: boolean;
};

function readPageMeta(
  result: FanzaImportResult,
): { ok: true; meta: PageMeta } | { ok: false; error: string } {
  if (result.itemCount === undefined || result.totalCount === undefined) {
    return { ok: false, error: "invalid_import_response" };
  }
  return {
    ok: true,
    meta: {
      itemCount: result.itemCount,
      totalCount: result.totalCount,
      hasNext: result.hasNext === true,
    },
  };
}

/**
 * Decide whether an imported page should continue pagination, finish, or fail.
 * Empty pages are only legitimate when validated metadata shows no remaining records.
 */
function evaluatePage(
  meta: PageMeta,
  totalFetchedItems: number,
): "continue" | "done" | "empty_page_positive_total" {
  if (meta.itemCount === 0) {
    if (meta.totalCount > totalFetchedItems || meta.hasNext) {
      return "empty_page_positive_total";
    }
    return "done";
  }
  return "continue";
}

/**
 * Finite progress guard: cursor must strictly advance, and page count cannot
 * exceed totalCount + 1 (worst case one item per page, plus one terminal probe).
 */
function assertProgress(
  cursor: number,
  previousCursor: number | null,
  pagesFetched: number,
  totalCount: number,
): string | null {
  if (previousCursor !== null && cursor <= previousCursor) {
    return "pagination_no_progress";
  }
  if (pagesFetched > totalCount + 1) {
    return "pagination_no_progress";
  }
  return null;
}

export async function runFanzaDoujinSync(): Promise<SourceSyncOutcome> {
  let page = 1;
  let previousPage: number | null = null;
  let inserted = 0;
  let updated = 0;
  let fetched = 0;
  let totalFetchedItems = 0;

  while (true) {
    if (previousPage !== null && page <= previousPage) {
      return { ok: false, error: "pagination_no_progress", counts: { inserted, updated }, fetched };
    }
    previousPage = page;

    const res = await fetchJson(doujinLibraryUrl(page));
    if (!res.ok) {
      return { ok: false, error: res.error, counts: { inserted, updated }, fetched };
    }

    const imported = await importFanzaOnServer("fanza_doujin", res.data);
    if (!imported.ok) {
      return { ok: false, error: imported.error, counts: { inserted, updated }, fetched };
    }
    const metaResult = readPageMeta(imported.result);
    if (!metaResult.ok) {
      return { ok: false, error: metaResult.error, counts: { inserted, updated }, fetched };
    }
    const meta = metaResult.meta;

    inserted += imported.result.inserted;
    updated += imported.result.updated;
    fetched += 1;

    const decision = evaluatePage(meta, totalFetchedItems);
    if (decision === "empty_page_positive_total") {
      return {
        ok: false,
        error: "empty_page_positive_total",
        counts: { inserted, updated },
        fetched,
      };
    }
    if (decision === "done") break;

    totalFetchedItems += meta.itemCount;
    if (totalFetchedItems >= meta.totalCount) break;
    if (!meta.hasNext) break;

    const capError = assertProgress(page + 1, page, fetched, meta.totalCount);
    if (capError) {
      return { ok: false, error: capError, counts: { inserted, updated }, fetched };
    }
    page += 1;
  }

  const marked = await markFanzaSyncedOnServer("fanza_doujin");
  if (!marked.ok) {
    return { ok: false, error: marked.error, counts: { inserted, updated }, fetched };
  }

  return { ok: true, counts: { inserted, updated }, fetched };
}

export async function runFanzaBooksSync(): Promise<SourceSyncOutcome> {
  let libPage = 1;
  let previousLibPage: number | null = null;
  const seriesQueue: Array<{
    seriesId: string;
    author: string | null;
    seriesRaw?: Record<string, unknown> | null;
  }> = [];
  const seenSeriesIds = new Set<string>();
  let inserted = 0;
  let updated = 0;
  let fetched = 0;
  let totalFetchedSeries = 0;

  while (true) {
    if (previousLibPage !== null && libPage <= previousLibPage) {
      return { ok: false, error: "pagination_no_progress", counts: { inserted, updated }, fetched };
    }
    previousLibPage = libPage;

    const libRes = await fetchJson(booksLibraryUrl(libPage));
    if (!libRes.ok) {
      return { ok: false, error: libRes.error, counts: { inserted, updated }, fetched };
    }
    const inspected = await importFanzaOnServer("fanza_books", libRes.data);
    if (!inspected.ok || !inspected.result.series) {
      return {
        ok: false,
        error: inspected.ok ? "invalid_import_response" : inspected.error,
        counts: { inserted, updated },
        fetched,
      };
    }
    const metaResult = readPageMeta(inspected.result);
    if (!metaResult.ok) {
      return { ok: false, error: metaResult.error, counts: { inserted, updated }, fetched };
    }
    const meta = metaResult.meta;
    fetched += 1;

    const decision = evaluatePage(meta, totalFetchedSeries);
    if (decision === "empty_page_positive_total") {
      return {
        ok: false,
        error: "empty_page_positive_total",
        counts: { inserted, updated },
        fetched,
      };
    }
    if (decision === "done") break;

    for (const series of inspected.result.series) {
      if (seenSeriesIds.has(series.seriesId)) {
        return {
          ok: false,
          error: "pagination_no_progress",
          counts: { inserted, updated },
          fetched,
        };
      }
      seenSeriesIds.add(series.seriesId);
      seriesQueue.push(series);
    }

    totalFetchedSeries += meta.itemCount;
    if (totalFetchedSeries >= meta.totalCount) break;
    if (!meta.hasNext) break;

    const capError = assertProgress(libPage + 1, libPage, fetched, meta.totalCount);
    if (capError) {
      return { ok: false, error: capError, counts: { inserted, updated }, fetched };
    }
    libPage += 1;
  }

  for (const series of seriesQueue) {
    let contentsPage = 1;
    let previousContentsPage: number | null = null;
    let totalFetchedVolumes = 0;

    while (true) {
      if (previousContentsPage !== null && contentsPage <= previousContentsPage) {
        return { ok: false, error: "pagination_no_progress", counts: { inserted, updated }, fetched };
      }
      previousContentsPage = contentsPage;

      const contentsRes = await fetchJson(booksContentsUrl(series.seriesId, contentsPage));
      if (!contentsRes.ok) {
        return { ok: false, error: contentsRes.error, counts: { inserted, updated }, fetched };
      }
      fetched += 1;

      const imported = await importFanzaOnServer("fanza_books", {
        seriesId: series.seriesId,
        author: series.author,
        seriesRaw: series.seriesRaw ?? null,
        payload: contentsRes.data,
      });
      if (!imported.ok) {
        return { ok: false, error: imported.error, counts: { inserted, updated }, fetched };
      }
      const metaResult = readPageMeta(imported.result);
      if (!metaResult.ok) {
        return { ok: false, error: metaResult.error, counts: { inserted, updated }, fetched };
      }
      const meta = metaResult.meta;

      inserted += imported.result.inserted;
      updated += imported.result.updated;

      const decision = evaluatePage(meta, totalFetchedVolumes);
      if (decision === "empty_page_positive_total") {
        return {
          ok: false,
          error: "empty_page_positive_total",
          counts: { inserted, updated },
          fetched,
        };
      }
      if (decision === "done") break;

      totalFetchedVolumes += meta.itemCount;
      if (totalFetchedVolumes >= meta.totalCount) break;
      if (!meta.hasNext) break;

      const capError = assertProgress(
        contentsPage + 1,
        contentsPage,
        contentsPage,
        meta.totalCount,
      );
      if (capError) {
        return { ok: false, error: capError, counts: { inserted, updated }, fetched };
      }
      contentsPage += 1;
    }
  }

  const marked = await markFanzaSyncedOnServer("fanza_books");
  if (!marked.ok) {
    return { ok: false, error: marked.error, counts: { inserted, updated }, fetched };
  }

  return { ok: true, counts: { inserted, updated }, fetched };
}

export async function runFanzaVideoSync(): Promise<SourceSyncOutcome> {
  let offset = 0;
  let previousOffset: number | null = null;
  const limit = 100;
  let inserted = 0;
  let updated = 0;
  let fetched = 0;
  let totalFetchedItems = 0;

  while (true) {
    if (previousOffset !== null && offset <= previousOffset) {
      return { ok: false, error: "pagination_no_progress", counts: { inserted, updated }, fetched };
    }
    previousOffset = offset;

    const body = videoPurchasedGraphqlBody(offset, limit);
    const res = await fetchVideoJson(VIDEO_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return { ok: false, error: res.error, counts: { inserted, updated }, fetched };
    }

    const imported = await importFanzaOnServer("fanza_video", res.data);
    if (!imported.ok) {
      return { ok: false, error: imported.error, counts: { inserted, updated }, fetched };
    }
    const metaResult = readPageMeta(imported.result);
    if (!metaResult.ok) {
      return { ok: false, error: metaResult.error, counts: { inserted, updated }, fetched };
    }
    const meta = metaResult.meta;

    inserted += imported.result.inserted;
    updated += imported.result.updated;
    fetched += 1;

    const decision = evaluatePage(meta, totalFetchedItems);
    if (decision === "empty_page_positive_total") {
      return {
        ok: false,
        error: "empty_page_positive_total",
        counts: { inserted, updated },
        fetched,
      };
    }
    if (decision === "done") break;

    totalFetchedItems += meta.itemCount;
    if (totalFetchedItems >= meta.totalCount) break;
    if (!meta.hasNext) break;

    const nextOffset = offset + limit;
    // pagesFetched approx: offset/limit + 1 already counted in fetched
    if (fetched > meta.totalCount + 1) {
      return {
        ok: false,
        error: "pagination_no_progress",
        counts: { inserted, updated },
        fetched,
      };
    }
    if (nextOffset <= offset) {
      return {
        ok: false,
        error: "pagination_no_progress",
        counts: { inserted, updated },
        fetched,
      };
    }
    offset = nextOffset;
  }

  const marked = await markFanzaSyncedOnServer("fanza_video");
  if (!marked.ok) {
    return { ok: false, error: marked.error, counts: { inserted, updated }, fetched };
  }

  return { ok: true, counts: { inserted, updated }, fetched };
}

export async function runFanzaDlsoftSync(): Promise<SourceSyncOutcome> {
  let page = 1;
  let inserted = 0;
  let updated = 0;
  let fetched = 0;
  let totalFetchedItems = 0;

  while (true) {
    const res = await fetchJson(dlsoftLibraryUrl(page));
    if (!res.ok) {
      return { ok: false, error: res.error, counts: { inserted, updated }, fetched };
    }

    const imported = await importFanzaOnServer("fanza_dlsoft", res.data);
    if (!imported.ok) {
      return { ok: false, error: imported.error, counts: { inserted, updated }, fetched };
    }
    inserted += imported.result.inserted;
    updated += imported.result.updated;
    fetched += 1;

    if (
      imported.result.itemCount === undefined ||
      imported.result.totalCount === undefined
    ) {
      return {
        ok: false,
        error: "invalid_import_response",
        counts: { inserted, updated },
        fetched,
      };
    }

    // Empty page while source still advertises remaining items is a source error —
    // do not mark successful sync-state.
    if (imported.result.itemCount === 0) {
      if (imported.result.totalCount > totalFetchedItems) {
        return {
          ok: false,
          error: "empty_page_positive_total",
          counts: { inserted, updated },
          fetched,
        };
      }
      break;
    }

    totalFetchedItems += imported.result.itemCount;
    if (totalFetchedItems >= imported.result.totalCount) break;
    page += 1;
  }

  const marked = await markFanzaSyncedOnServer("fanza_dlsoft");
  if (!marked.ok) {
    return { ok: false, error: marked.error, counts: { inserted, updated }, fetched };
  }

  return { ok: true, counts: { inserted, updated }, fetched };
}

export async function runAllFanzaSyncs(): Promise<Record<string, SourceSyncOutcome>> {
  const doujin = await runFanzaDoujinSync();
  const books = await runFanzaBooksSync();
  const video = await runFanzaVideoSync();
  const dlsoft = await runFanzaDlsoftSync();
  return {
    fanza_doujin: doujin,
    fanza_books: books,
    fanza_video: video,
    fanza_dlsoft: dlsoft,
  };
}
