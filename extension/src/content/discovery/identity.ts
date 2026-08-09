import { makerMatchKey, titleMatchKey } from "@adp/shared";
import type { DiscoveryCandidate } from "../../messages.js";

export type IdentityGateOutcome =
  | { kind: "unique_exact"; candidate: DiscoveryCandidate }
  | { kind: "candidates"; candidates: DiscoveryCandidate[] }
  | { kind: "none" };

export type OriginIdentity = {
  title: string;
  maker: string | null;
};

/**
 * Strict identity gate for discovery auto-navigation.
 *
 * Auto-confirm (`unique_exact`) only when:
 * - origin and candidate makers are both non-empty and makerMatchKey equal
 * - titleMatchKey is exact equal
 * - exactly one such candidate exists
 *
 * Title-only, maker-null, multi-candidate, or dice/L5-only matches never auto-confirm.
 * Non-auto candidates are returned ranked for the picker (max 10, caller may slice).
 */
export function scoreDiscoveryCandidates(
  origin: OriginIdentity,
  candidates: readonly DiscoveryCandidate[],
  maxPicker = 10,
): IdentityGateOutcome {
  if (candidates.length === 0) return { kind: "none" };

  const originTitleKey = titleMatchKey(origin.title);
  const originMakerKey = makerMatchKey(origin.maker);
  const originMakerPresent = originMakerKey.length > 0;

  const exact: DiscoveryCandidate[] = [];
  for (const c of candidates) {
    const titleOk = titleMatchKey(c.title) === originTitleKey && originTitleKey.length > 0;
    const candMakerKey = makerMatchKey(c.maker);
    const makerOk =
      originMakerPresent && candMakerKey.length > 0 && candMakerKey === originMakerKey;
    if (titleOk && makerOk) exact.push(c);
  }

  if (exact.length === 1) {
    return { kind: "unique_exact", candidate: exact[0]! };
  }

  // Picker: preserve search rank order; cap at maxPicker. Never auto-confirm.
  const picker = candidates.slice(0, maxPicker);
  if (picker.length === 0) return { kind: "none" };
  return { kind: "candidates", candidates: picker };
}
