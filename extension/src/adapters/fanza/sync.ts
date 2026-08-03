import {
  doujinLibraryUrl,
  doujinPageHasNext,
} from "@adp/shared/adapters/fanza_doujin";
import {
  booksLibraryUrl,
  booksLibraryHasNext,
  booksContentsUrl,
  booksContentsHasNext,
  parseBooksLibraryPayload,
  type FanzaBooksSeriesRef,
} from "@adp/shared/adapters/fanza_books";
import {
  VIDEO_GRAPHQL_URL,
  videoPurchasedGraphqlBody,
  videoPageHasNext,
} from "@adp/shared/adapters/fanza_video";
import {
  dlsoftLibraryUrl,
  dlsoftPageHasNext,
  parseDlsoftLibraryPayload,
} from "@adp/shared/adapters/fanza_dlsoft";
import {
  importFanzaOnServer,
  markFanzaSyncedOnServer,
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

export async function runFanzaDoujinSync(): Promise<SourceSyncOutcome> {
  let page = 1;
  let inserted = 0;
  let updated = 0;
  let fetched = 0;

  while (true) {
    const res = await fetchJson(doujinLibraryUrl(page));
    if (!res.ok) {
      return { ok: false, error: res.error, counts: { inserted, updated }, fetched };
    }

    const imported = await importFanzaOnServer("fanza_doujin", res.data);
    if (!imported.ok) {
      return { ok: false, error: imported.error, counts: { inserted, updated }, fetched };
    }
    inserted += imported.counts.inserted;
    updated += imported.counts.updated;
    fetched += 1;

    if (!doujinPageHasNext(res.data)) break;
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
  const seriesQueue: FanzaBooksSeriesRef[] = [];
  let inserted = 0;
  let updated = 0;
  let fetched = 0;

  while (true) {
    const libRes = await fetchJson(booksLibraryUrl(libPage));
    if (!libRes.ok) {
      return { ok: false, error: libRes.error, counts: { inserted, updated }, fetched };
    }
    fetched += 1;

    const seriesOnPage = parseBooksLibraryPayload(libRes.data);
    seriesQueue.push(...seriesOnPage);

    if (!booksLibraryHasNext(libRes.data)) break;
    libPage += 1;
  }

  for (const series of seriesQueue) {
    let contentsPage = 1;
    while (true) {
      const contentsRes = await fetchJson(booksContentsUrl(series.seriesId, contentsPage));
      if (!contentsRes.ok) {
        return { ok: false, error: contentsRes.error, counts: { inserted, updated }, fetched };
      }
      fetched += 1;

      const imported = await importFanzaOnServer("fanza_books", {
        seriesId: series.seriesId,
        author: series.author,
        payload: contentsRes.data,
      });
      if (!imported.ok) {
        return { ok: false, error: imported.error, counts: { inserted, updated }, fetched };
      }
      inserted += imported.counts.inserted;
      updated += imported.counts.updated;

      if (!booksContentsHasNext(contentsRes.data)) break;
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
  const limit = 100;
  let inserted = 0;
  let updated = 0;
  let fetched = 0;

  while (true) {
    const body = videoPurchasedGraphqlBody(offset, limit);
    const res = await fetchJson(VIDEO_GRAPHQL_URL, {
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
    inserted += imported.counts.inserted;
    updated += imported.counts.updated;
    fetched += 1;

    if (!videoPageHasNext(res.data)) break;
    offset += limit;
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
    inserted += imported.counts.inserted;
    updated += imported.counts.updated;
    fetched += 1;

    const items = parseDlsoftLibraryPayload(res.data);
    totalFetchedItems += items.length;

    if (!dlsoftPageHasNext(res.data, totalFetchedItems)) break;
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
