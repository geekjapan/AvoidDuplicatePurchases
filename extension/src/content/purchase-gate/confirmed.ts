import type { LookupHit } from "../types.js";

/**
 * Confirmed duplicate = same-store owned OR cross-store exact match (`other`).
 * Fuzzy candidates (`possible`) never count (ADR-0001 / domain glossary).
 */
export function isConfirmedDuplicate(hit: LookupHit | null | undefined): boolean {
  if (!hit) return false;
  return hit.owned || hit.other.length > 0;
}

/** True when any lookup hit is a confirmed duplicate. */
export function hasConfirmedDuplicate(
  hits: Array<LookupHit | null | undefined> | null | undefined,
): boolean {
  if (!hits) return false;
  return hits.some((hit) => isConfirmedDuplicate(hit));
}
