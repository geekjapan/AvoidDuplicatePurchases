/**
 * Human-approved redacted cart-verification gate (Issue #12 / T-CART-HUMAN).
 * Raw evidence stays private; this marker is the only downstream reference.
 */
export const CART_GATE_REFERENCE = {
  issueUrl: "https://github.com/geekjapan/AvoidDuplicatePurchases/issues/12",
  humanGateCommit: "24c4bbe166f02c1ab5679789d58ea2627809f965",
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
 * Links accepted T-FANZA and T-CART-HUMAN commits without raw records or GitHub publication.
 */
export const FANZA_CART_RECHECK_CHECKPOINT = {
  mode: "synthetic-local-import-pipeline" as const,
  /** Accepted T-FANZA commit (blocker J empty-page pagination). */
  fanzaCommit: "a31b7e3d97dc0f394d53aa608742e822931fb92a",
  /** Accepted T-CART-HUMAN redacted gate commit. */
  cartHumanCommit: "24c4bbe166f02c1ab5679789d58ea2627809f965",
  /** Synthetic redacted cid used only in local fixtures/tests. */
  syntheticCid: "d_900001",
} as const;
