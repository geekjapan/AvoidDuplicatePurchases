import {
  CandidatesResponseSchema,
  ListingsResponseSchema,
  WorkAssignmentResponseSchema,
  type ListingsResponse,
} from "@adp/shared";

export type Listing = ListingsResponse["listings"][number];

async function apiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; parse?: (v: unknown) => T } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: options.method ?? "GET",
    headers:
      options.body !== undefined
        ? { "Content-Type": "application/json" }
        : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text.length ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${text}`);
  }
  if (options.parse) return options.parse(json);
  return json as T;
}

const LISTINGS_PAGE_SIZE = 500;

/**
 * Fetch the complete listing set via the shared limit/offset contract.
 * Default server page is 500; SPA must not stop at the first page.
 */
export async function fetchListings(params: {
  q?: string;
  source?: string;
  maker?: string;
}): Promise<ListingsResponse> {
  const all: Listing[] = [];
  let offset = 0;
  let total: number | undefined;

  for (;;) {
    const search = new URLSearchParams();
    if (params.q) search.set("q", params.q);
    if (params.source) search.set("source", params.source);
    if (params.maker) search.set("maker", params.maker);
    search.set("limit", String(LISTINGS_PAGE_SIZE));
    search.set("offset", String(offset));
    const qs = search.toString();
    const page = await apiFetch(`/api/listings?${qs}`, {
      parse: (v) => ListingsResponseSchema.parse(v),
    });
    all.push(...page.listings);
    if (typeof page.total === "number") total = page.total;
    if (page.listings.length === 0) break;
    offset += page.listings.length;
    if (page.listings.length < LISTINGS_PAGE_SIZE) break;
    if (total !== undefined && offset >= total) break;
  }

  return ListingsResponseSchema.parse({
    listings: all,
    total: total ?? all.length,
  });
}

export async function fetchCandidates() {
  return apiFetch("/api/candidates", {
    parse: (v) => CandidatesResponseSchema.parse(v),
  });
}

export async function decideCandidate(id: number, same: boolean) {
  return apiFetch(`/api/candidates/${id}`, {
    method: "POST",
    body: { same },
    parse: (v) => v,
  });
}

export type WorkAssignOptions =
  | { workId: number; lock?: boolean }
  | { allocateNew: true; lock?: boolean };

/**
 * Assign an existing work (merge) or allocate a fresh work server-side (split).
 * Client never invents work ids.
 */
export async function assignWork(
  source: string,
  cid: string,
  options: WorkAssignOptions,
) {
  const body =
    "allocateNew" in options && options.allocateNew
      ? { allocateNew: true as const, lock: options.lock ?? true }
      : {
          workId: (options as { workId: number }).workId,
          lock: options.lock ?? true,
        };
  return apiFetch(
    `/api/listings/${encodeURIComponent(source)}/${encodeURIComponent(cid)}/work`,
    {
      method: "POST",
      body,
      parse: (v) => WorkAssignmentResponseSchema.parse(v),
    },
  );
}
