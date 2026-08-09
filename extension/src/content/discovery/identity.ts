import { dice, key, makerMatchKey, titleMatchKey } from "@adp/shared";
import type { DiscoveryCandidate } from "../../messages.js";

export type IdentityGateOutcome =
  | { kind: "unique_exact"; candidate: DiscoveryCandidate }
  | { kind: "candidates"; candidates: DiscoveryCandidate[] }
  | { kind: "none" };

export type OriginIdentity = {
  title: string;
  maker: string | null;
};

/** Relevance band for picker (design §2.5): maker match + dice ≥ 0.7. */
export const RELEVANCE_DICE_THRESHOLD = 0.7;

/**
 * Pre-L5 title key (L1–L4 only). Volume/chapter markers remain so
 * 「第1巻」vs「第2巻」do not collapse for unique_exact.
 */
export function titlePreVolumeKey(title: string): string {
  return key(title, 4);
}

function makerKeysEqual(
  originMaker: string | null,
  candidateMaker: string | null,
): boolean {
  const originMakerKey = makerMatchKey(originMaker);
  const candMakerKey = makerMatchKey(candidateMaker);
  return (
    originMakerKey.length > 0 &&
    candMakerKey.length > 0 &&
    candMakerKey === originMakerKey
  );
}

/**
 * Strict identity gate for discovery auto-navigation.
 *
 * Auto-confirm (`unique_exact`) only when:
 * - origin and candidate makers are both non-empty and makerMatchKey equal
 * - titleMatchKey is exact equal
 * - pre-L5 (non-volume-stripped) title keys are exact equal
 * - exactly one such candidate exists
 *
 * Picker rules:
 * - multi exact → only those exact rows (max 10)
 * - otherwise only relevant rows: titleMatchKey equal, or maker match with
 *   dice(titleMatchKey) ≥ 0.7; empty → none
 * - title-only / L5-only / multi never auto-confirm
 */
export function scoreDiscoveryCandidates(
  origin: OriginIdentity,
  candidates: readonly DiscoveryCandidate[],
  maxPicker = 10,
): IdentityGateOutcome {
  if (candidates.length === 0) return { kind: "none" };

  const originTitleKey = titleMatchKey(origin.title);
  const originPreVolumeKey = titlePreVolumeKey(origin.title);

  const exact: DiscoveryCandidate[] = [];
  const titleKeyHits: DiscoveryCandidate[] = [];
  const diceHits: DiscoveryCandidate[] = [];

  for (const c of candidates) {
    const candTitleKey = titleMatchKey(c.title);
    const titleKeyOk =
      originTitleKey.length > 0 && candTitleKey === originTitleKey;
    const makerOk = makerKeysEqual(origin.maker, c.maker);
    const preVolumeOk =
      originPreVolumeKey.length > 0 &&
      titlePreVolumeKey(c.title) === originPreVolumeKey;

    if (titleKeyOk && makerOk && preVolumeOk) {
      exact.push(c);
    }
    if (titleKeyOk) {
      titleKeyHits.push(c);
    } else if (
      makerOk &&
      originTitleKey.length > 0 &&
      candTitleKey.length > 0 &&
      dice(originTitleKey, candTitleKey) >= RELEVANCE_DICE_THRESHOLD
    ) {
      diceHits.push(c);
    }
  }

  if (exact.length === 1) {
    return { kind: "unique_exact", candidate: exact[0]! };
  }

  if (exact.length >= 2) {
    return { kind: "candidates", candidates: exact.slice(0, maxPicker) };
  }

  // Relevant picker set: preserve original search rank order.
  // titleMatchKey hits first (includes L5-only volume variants + title-only),
  // then maker+dice band, de-duplicated by cid.
  const seen = new Set<string>();
  const relevant: DiscoveryCandidate[] = [];
  for (const c of [...titleKeyHits, ...diceHits]) {
    if (seen.has(c.cid)) continue;
    seen.add(c.cid);
    relevant.push(c);
  }
  // Re-sort by original rank to keep search order stable.
  relevant.sort((a, b) => a.rank - b.rank);

  if (relevant.length === 0) return { kind: "none" };
  return { kind: "candidates", candidates: relevant.slice(0, maxPicker) };
}
