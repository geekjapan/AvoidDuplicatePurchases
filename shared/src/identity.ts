/** Listing source identifiers aligned with the SQLite `listing.source` CHECK constraint. */
export const SOURCES = [
  "dlsite",
  "fanza_doujin",
  "fanza_books",
  "fanza_video",
  "fanza_dlsoft",
  "amazon",
  "ebookjapan",
  "kobo",
] as const;

export type Source = (typeof SOURCES)[number];

/**
 * Sources synced from the signed-in provider library DOM (user-initiated).
 * These are the sources of the typed library-sync protocol; the legacy
 * five sources keep their adapter-based import paths.
 */
export const LIBRARY_SOURCES = ["amazon", "ebookjapan", "kobo"] as const;

export type LibrarySource = (typeof LIBRARY_SOURCES)[number];

/**
 * Explicit acquisition/access states observed on provider library pages.
 * The generic layer only passes these through; it never infers ownership
 * from a title, price, or page presence. Provider readers map DOM evidence
 * to these states in later tasks.
 */
export const LIBRARY_ITEM_STATES = [
  "purchased",
  "free",
  "rental",
  "sample",
  "preview",
  "subscription",
  "gift",
  "reservation",
  "unknown",
] as const;

export type LibraryItemState = (typeof LIBRARY_ITEM_STATES)[number];

/** Start pages of the user-initiated library sync (scope-delta 2026-08-08). */
export interface LibrarySyncProvider {
  source: LibrarySource;
  /**
   * Signed-in library entry URL the sync navigates to. amazon / ebookjapan /
   * kobo entries are confirmed by the provider reader observations
   * (single place to update).
   */
  startUrl: string;
}

export const LIBRARY_SYNC_PROVIDERS: readonly LibrarySyncProvider[] = [
  {
    source: "amazon",
    startUrl: "https://www.amazon.co.jp/hz/mycd/digital-console/contentlist/booksAll/",
  },
  { source: "ebookjapan", startUrl: "https://ebookjapan.yahoo.co.jp/bookshelf/" },
  { source: "kobo", startUrl: "https://books.rakuten.co.jp/e-book/kobo/library/" },
];

function parseCredentialFreeHttpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== ""
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function hasOnlyPositiveQuery(url: URL, name: string): boolean {
  const values = url.searchParams.getAll(name);
  if (values.length > 1 || values[0] === undefined || !/^[1-9]\d*$/.test(values[0])) {
    return false;
  }
  for (const key of url.searchParams.keys()) {
    if (key !== name) return false;
  }
  return true;
}

/**
 * API-side page identity gate for visible DOM library batches. The readers
 * canonicalize these URLs before sending them; query values not used for
 * pagination are deliberately rejected at the server boundary.
 */
export function isCanonicalLibraryPageUrl(source: LibrarySource, value: string): boolean {
  const url = parseCredentialFreeHttpsUrl(value);
  if (!url || url.hash !== "") return false;

  switch (source) {
    case "amazon":
      return (
        url.hostname === "www.amazon.co.jp" &&
        (url.pathname === "/hz/mycd/digital-console/contentlist/booksAll" ||
          url.pathname === "/hz/mycd/digital-console/contentlist/booksAll/") &&
        (url.search === "" || hasOnlyPositiveQuery(url, "pageNumber"))
      );
    case "ebookjapan":
      return (
        url.hostname === "ebookjapan.yahoo.co.jp" &&
        (url.pathname === "/bookshelf" || url.pathname === "/bookshelf/") &&
        (url.search === "" || hasOnlyPositiveQuery(url, "page"))
      );
    case "kobo":
      return (
        url.hostname === "books.rakuten.co.jp" &&
        /^\/e-book\/kobo\/library(?:\/page\/[1-9]\d*)?\/?$/.test(url.pathname) &&
        url.search === ""
      );
  }
}

/** Validate the provider-specific CID format before any library persistence. */
export function isLibraryCid(source: LibrarySource, cid: string): boolean {
  switch (source) {
    case "amazon":
      return /^[A-Z0-9]{10}$/.test(cid);
    case "ebookjapan":
      return /^[A-Za-z0-9]+$/.test(cid);
    case "kobo":
      return /^[A-Za-z0-9_-]+$/.test(cid);
  }
}

/**
 * Return a canonical product URL only when the visible link belongs to the
 * provider and its embedded identifier matches the DOM row CID.
 */
export function canonicalLibraryProductUrl(
  source: LibrarySource,
  cid: string,
  value: string,
): string | null {
  const url = parseCredentialFreeHttpsUrl(value);
  if (!url || url.search !== "" || url.hash !== "" || !isLibraryCid(source, cid)) {
    return null;
  }

  switch (source) {
    case "amazon": {
      if (url.hostname !== "www.amazon.co.jp") return null;
      const match = /^\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Za-z0-9]{10})\/?$/i.exec(
        url.pathname,
      );
      if (!match || match[1]!.toUpperCase() !== cid) return null;
      const path = url.pathname.endsWith("/")
        ? url.pathname.slice(0, -1)
        : url.pathname;
      return `${url.origin}${path}`;
    }
    case "ebookjapan": {
      if (url.hostname !== "ebookjapan.yahoo.co.jp") return null;
      const match = /^\/books\/\d+\/([A-Za-z0-9]+)\/?$/.exec(url.pathname);
      if (!match || match[1] !== cid) return null;
      const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
      return `${url.origin}${path}`;
    }
    case "kobo": {
      if (url.hostname !== "books.rakuten.co.jp") return null;
      const match = /^\/rk\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
      if (!match || match[1] !== cid) return null;
      const path = url.pathname.endsWith("/")
        ? url.pathname.slice(0, -1)
        : url.pathname;
      return `${url.origin}${path}`;
    }
  }
}

export function isCanonicalLibraryProductUrl(
  source: LibrarySource,
  cid: string,
  value: string,
): boolean {
  return canonicalLibraryProductUrl(source, cid, value) !== null;
}

/** Resolve the library-sync provider entry for a source, if registered. */
export function librarySyncProvider(
  source: string,
): LibrarySyncProvider | null {
  return LIBRARY_SYNC_PROVIDERS.find((p) => p.source === source) ?? null;
}

/** First-wave intervention stores (page + cart UI). */
export const INTERVENTION_SOURCES = ["dlsite", "fanza_doujin", "fanza_books"] as const;

export type InterventionSource = (typeof INTERVENTION_SOURCES)[number];

/** Stable product identity for cross-site deduplication. External refs use `(source, cid)`. */
export interface ProductIdentity {
  source: Source;
  cid: string;
}

/** Normalized listing fields used for match_key derivation and lookup. */
export interface ListingIdentity extends ProductIdentity {
  title: string;
  maker?: string | null;
}

/** Composite key string for maps and logs. */
export function productKey(identity: ProductIdentity): string {
  return `${identity.source}:${identity.cid}`;
}

/** Normalize a cid per store conventions (trim + uppercase for DLsite worknos). */
export function normalizeCid(source: Source, cid: string): string {
  const trimmed = cid.trim();
  if (source === "dlsite") {
    return trimmed.toUpperCase();
  }
  return trimmed;
}

/** Build a normalized product identity, rejecting empty cids. */
export function makeProductIdentity(source: Source, cid: string): ProductIdentity {
  const normalized = normalizeCid(source, cid);
  if (!normalized) {
    throw new Error(`empty cid for source ${source}`);
  }
  return { source, cid: normalized };
}
