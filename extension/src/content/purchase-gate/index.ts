export { isConfirmedDuplicate, hasConfirmedDuplicate } from "./confirmed.js";
export { gateReasonMessage } from "./messages.js";
export { isPurchaseProgressPage } from "./page-kind.js";
export { findPurchaseCtas } from "./cta.js";
export {
  mountPurchaseGate,
  unmountPurchaseGate,
  isPurchaseGateMounted,
} from "./mount.js";
export {
  writeConfirmedDuplicateCids,
  readConfirmedDuplicateCids,
  clearConfirmedDuplicateCids,
  type GateStateStore,
} from "./gate-state.js";
export {
  applyConfirmedDuplicateGate,
  applyProductImmediateBuyGate,
  collectConfirmedDuplicateCids,
} from "./apply.js";
export { runPurchaseProgressPage } from "./progress-runner.js";
export {
  ADP_GATE_BANNER_ID,
  ADP_GATED_ATTR,
  ADP_CTA_ATTR,
  type GateSurface,
  type PurchaseCtaRole,
} from "./types.js";
