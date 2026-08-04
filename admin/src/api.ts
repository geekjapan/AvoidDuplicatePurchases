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

export async function fetchListings(params: {
  q?: string;
  source?: string;
  maker?: string;
}) {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.source) search.set("source", params.source);
  if (params.maker) search.set("maker", params.maker);
  const qs = search.toString();
  return apiFetch(`/api/listings${qs ? `?${qs}` : ""}`, {
    parse: (v) => ListingsResponseSchema.parse(v),
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

export async function assignWork(
  source: string,
  cid: string,
  workId: number,
  lock = true,
) {
  return apiFetch(`/api/listings/${encodeURIComponent(source)}/${encodeURIComponent(cid)}/work`, {
    method: "POST",
    body: { workId, lock },
    parse: (v) => WorkAssignmentResponseSchema.parse(v),
  });
}

export function maxWorkId(listings: Listing[]): number {
  return listings.reduce((max, l) => Math.max(max, l.workId), 0);
}
