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
