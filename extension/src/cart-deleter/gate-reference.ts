/**
 * Human-approved redacted cart-verification gate (Issue #12 / T-CART-HUMAN).
 * Raw evidence stays private; this marker is the only downstream reference.
 *
 * Evidence policy (user-approved, SPEC-CART-006):
 * - This object is **human evidence**: stable SHAs of accepted redacted
 *   checkpoints. Real cart operations are not re-executed for gate refresh.
 * - Synthetic E2E (FANZA_CART_RECHECK_CHECKPOINT + cart.e2e) is separate
 *   **functional evidence** only; it must not be treated as human gate proof.
 */
export const CART_GATE_REFERENCE = {
  issueUrl: "https://github.com/geekjapan/AvoidDuplicatePurchases/issues/12",
  /** Accepted T-CART-HUMAN redacted checkpoint (stable human evidence). */
  humanGateCommit: "24c4bbe166f02c1ab5679789d58ea2627809f965",
  /** Accepted T-FANZA commit referenced as companion stable human evidence. */
  fanzaAcceptedCommit: "a31b7e3d97dc0f394d53aa608742e822931fb92a",
  evidenceKind: "human-redacted-checkpoint" as const,
  stores: ["dlsite", "fanza-doujin", "fanza-books"] as const,
  verifiedCapabilities: [
    "per-cid GET delete loop (DLsite)",
    "live cart _token (FANZA Doujin)",
    "live cart own_url (FANZA Books)",
    "delete then restore on all three stores",
  ] as const,
};

/**
 * Local synthetic FANZA post-import cart recheck checkpoint.
 * Functional evidence only — links accepted T-FANZA / T-CART-HUMAN SHAs as
 * stable references without raw records, real cart re-execution, or GitHub
 * publication of private evidence.
 */
export const FANZA_CART_RECHECK_CHECKPOINT = {
  mode: "synthetic-local-import-pipeline" as const,
  evidenceKind: "synthetic-functional-e2e" as const,
  /** Accepted T-FANZA commit (blocker J empty-page pagination) — stable ref. */
  fanzaCommit: "a31b7e3d97dc0f394d53aa608742e822931fb92a",
  /** Accepted T-CART-HUMAN redacted gate commit — stable human evidence ref. */
  cartHumanCommit: "24c4bbe166f02c1ab5679789d58ea2627809f965",
  /** Synthetic redacted cid used only in local fixtures/tests. */
  syntheticCid: "d_900001",
} as const;
