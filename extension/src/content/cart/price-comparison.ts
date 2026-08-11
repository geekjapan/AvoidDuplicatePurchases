import type { InterventionSource, Money } from "@adp/shared";

import {
  MSG_DISCOVERY_RESULT,
  MSG_DISCOVERY_SELECT,
  MSG_DISCOVERY_START,
  MSG_DISCOVERY_STATUS,
  type DiscoveryCandidate,
  type DiscoveryFailureCode,
  type DiscoveryPriceTiers,
  type DiscoveryResultMessage,
  type DiscoverySelectReply,
  type DiscoverySource,
  type DiscoveryStartMessage,
  type DiscoveryStartReply,
  isDiscoverySource,
} from "../../messages.js";
import { approvedStoreHttpsUrl } from "../banner.js";
import { ensureCartStyles } from "./styles.js";
import {
  compareFinalPrices,
  finalPriceTiers,
  formatFinalPrice,
  type FinalPriceVerdict,
} from "./final-price.js";
import type { CartRow } from "./types.js";

export const ADP_CART_PRICE_COMPARISON_CLASS = "adp-cart-price-comparison";
const MOUNT_ATTR = "data-adp-cart-price-comparison";

const SOURCE_LABELS: Record<DiscoverySource, string> = {
  dlsite: "DLsite",
  fanza_doujin: "FANZA同人",
};

const FAILURE_MESSAGES: Record<DiscoveryFailureCode, string> = {
  discovery_login_required: "相手ストアでログインが必要です",
  discovery_age_gate: "相手ページの年齢確認をブラウザで完了してください",
  discovery_search_timeout: "相手ストアの検索がタイムアウトしました",
  discovery_no_match: "同一作品候補が見つかりませんでした",
  discovery_ambiguous: "候補を選択してください",
  discovery_product_mismatch: "遷移先の商品が一致しません",
  discovery_price_unavailable: "価格が取得できませんでした",
  discovery_blocked_policy: "この商品リンクは安全確認できませんでした",
  discovery_unsupported_source: "このストア間の比較は未対応です",
  discovery_invalid_request: "比較リクエストが不正です",
  discovery_no_tab: "相手ストアのタブを開けませんでした",
  discovery_url_too_long: "検索URLが長すぎるため中止しました",
  discovery_receiver_not_ready: "相手ページの読み取り準備ができませんでした",
  discovery_session_lost: "比較セッションが失われました",
  discovery_cancelled: "比較をキャンセルしました",
};

type MessageListener = (message: unknown) => boolean;

export type CartPriceComparisonDeps = {
  sendStart?: (message: DiscoveryStartMessage) => Promise<DiscoveryStartReply | undefined>;
  sendSelect?: (message: {
    type: typeof MSG_DISCOVERY_SELECT;
    sessionId: string;
    productUrl: string;
    targetSource: DiscoverySource;
    cid: string;
  }) => Promise<DiscoverySelectReply | undefined>;
  addMessageListener?: (listener: MessageListener) => void;
  removeMessageListener?: (listener: MessageListener) => void;
  createSessionId?: () => string;
};

function newSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `cart_disc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function defaultSendStart(
  message: DiscoveryStartMessage,
): Promise<DiscoveryStartReply | undefined> {
  return chrome.runtime.sendMessage(message) as Promise<DiscoveryStartReply | undefined>;
}

function defaultSendSelect(message: {
  type: typeof MSG_DISCOVERY_SELECT;
  sessionId: string;
  productUrl: string;
  targetSource: DiscoverySource;
  cid: string;
}): Promise<DiscoverySelectReply | undefined> {
  return chrome.runtime.sendMessage(message) as Promise<DiscoverySelectReply | undefined>;
}

function defaultAddMessageListener(listener: MessageListener): void {
  chrome.runtime.onMessage.addListener(listener);
}

function defaultRemoveMessageListener(listener: MessageListener): void {
  chrome.runtime.onMessage.removeListener(listener);
}

function setStatus(
  status: HTMLElement,
  text: string,
  kind: "idle" | "busy" | "error" | "ok",
): void {
  status.textContent = text;
  status.setAttribute("data-kind", kind);
}

function clearDynamic(panel: HTMLElement): void {
  panel.querySelector(".adp-cart-price-comparison__prices")?.remove();
  panel.querySelector(".adp-cart-price-comparison__link")?.remove();
  panel.querySelector(".adp-cart-price-comparison__candidates")?.remove();
}

function formatVerdict(
  verdict: FinalPriceVerdict,
  originLabel: string,
  targetLabel: string,
): string {
  switch (verdict) {
    case "origin_cheaper":
      return `${originLabel}が安い`;
    case "target_cheaper":
      return `${targetLabel}が安い`;
    case "equal":
      return "同額";
    default:
      return "比較不可";
  }
}

function renderCandidates(
  panel: HTMLElement,
  candidates: readonly DiscoveryCandidate[],
  onSelect: (candidate: DiscoveryCandidate) => void,
): void {
  const doc = panel.ownerDocument!;
  const list = doc.createElement("div");
  list.className = "adp-cart-price-comparison__candidates";
  for (const candidate of candidates) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "adp-cart-price-comparison__candidate";
    button.textContent = `${candidate.title}${candidate.maker ? ` / ${candidate.maker}` : ""}`;
    button.onclick = () => onSelect(candidate);
    list.appendChild(button);
  }
  panel.appendChild(list);
}

function renderCompare(
  panel: HTMLElement,
  result: Extract<DiscoveryResultMessage, { ok: true; kind: "compare" }>,
  originSource: DiscoverySource,
): void {
  clearDynamic(panel);
  const doc = panel.ownerDocument!;
  const originLabel = SOURCE_LABELS[originSource];
  const targetLabel = SOURCE_LABELS[result.targetSource];
  const originPrice = selectFinalPriceFromDiscovery(result.originTiers);
  const targetPrice = selectFinalPriceFromDiscovery(result.targetTiers);
  const verdict = compareFinalPrices(originPrice, targetPrice);

  const prices = doc.createElement("span");
  prices.className = "adp-cart-price-comparison__prices";
  prices.textContent =
    `最終価格: ${originLabel} ${formatFinalPrice(originPrice)} / ` +
    `${targetLabel} ${formatFinalPrice(targetPrice)} — ` +
    formatVerdict(verdict, originLabel, targetLabel);
  panel.appendChild(prices);

  const safeUrl = approvedStoreHttpsUrl(result.targetProductUrl, result.targetSource);
  if (safeUrl) {
    const link = doc.createElement("a");
    link.className = "adp-cart-price-comparison__link";
    link.href = safeUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `${targetLabel}の商品`;
    panel.appendChild(link);
  }
}

function selectFinalPriceFromDiscovery(tiers: DiscoveryPriceTiers): Money | null {
  return tiers.coupon ?? tiers.sale ?? tiers.regular;
}

/**
 * Mount a user-triggered, per-row cross-store comparison.  The cart page does
 * not crawl the counterpart store on load; it reuses the existing discovery
 * protocol only after the user presses this row's button.
 */
export function mountCartPriceComparison(
  doc: Document,
  source: InterventionSource,
  row: CartRow,
  finalPrice: Money | null,
  deps: CartPriceComparisonDeps = {},
): void {
  if (!isDiscoverySource(source)) return;
  if (row.host.querySelector(`.${ADP_CART_PRICE_COMPARISON_CLASS}`)) return;

  ensureCartStyles(doc);
  const panel = doc.createElement("div");
  panel.className = ADP_CART_PRICE_COMPARISON_CLASS;
  panel.setAttribute(MOUNT_ATTR, row.cid);

  const button = doc.createElement("button");
  button.type = "button";
  button.className = "adp-cart-price-comparison__button";
  button.textContent = "価格比較";
  panel.appendChild(button);

  const status = doc.createElement("span");
  status.className = "adp-cart-price-comparison__status";
  status.setAttribute("data-kind", "idle");
  status.textContent = "相手サイトの最終価格を確認";
  panel.appendChild(status);
  row.host.insertAdjacentElement("afterbegin", panel);

  const sendStart = deps.sendStart ?? defaultSendStart;
  const sendSelect = deps.sendSelect ?? defaultSendSelect;
  const addListener = deps.addMessageListener ?? defaultAddMessageListener;
  const removeListener = deps.removeMessageListener ?? defaultRemoveMessageListener;
  const makeSessionId = deps.createSessionId ?? newSessionId;
  let activeSessionId: string | null = null;
  let busy = false;
  let listener: MessageListener | null = null;

  const detach = (): void => {
    if (listener) removeListener(listener);
    listener = null;
    activeSessionId = null;
  };

  const fail = (message: string): void => {
    detach();
    clearDynamic(panel);
    setStatus(status, message, "error");
    busy = false;
    button.disabled = false;
  };

  const selectCandidate = async (candidate: DiscoveryCandidate): Promise<void> => {
    if (!activeSessionId || busy) return;
    busy = true;
    button.disabled = true;
    setStatus(status, "選択した候補の最終価格を確認中…", "busy");
    try {
      const reply = await sendSelect({
        type: MSG_DISCOVERY_SELECT,
        sessionId: activeSessionId,
        productUrl: candidate.productUrl,
        targetSource: candidate.targetSource,
        cid: candidate.cid,
      });
      if (!reply?.ok) {
        fail(
          FAILURE_MESSAGES[(reply?.error as DiscoveryFailureCode) ?? "discovery_session_lost"] ??
            String(reply?.error ?? "比較に失敗しました"),
        );
      }
    } catch {
      fail("相手商品の読み取りに失敗しました");
    }
  };

  const start = (): void => {
    if (busy) return;
    detach();
    clearDynamic(panel);
    const sessionId = makeSessionId();
    activeSessionId = sessionId;
    busy = true;
    button.disabled = true;
    setStatus(status, "相手ストアを検索しています…", "busy");

    listener = (message: unknown): boolean => {
      if (!message || typeof message !== "object") return false;
      const candidate = message as { type?: string; sessionId?: string };
      if (candidate.sessionId !== activeSessionId) return false;

      if (candidate.type === MSG_DISCOVERY_STATUS) {
        const statusMessage = message as { message?: string; phase?: string; failureCode?: DiscoveryFailureCode };
        if (statusMessage.phase === "failed" && statusMessage.failureCode) {
          fail(FAILURE_MESSAGES[statusMessage.failureCode] ?? statusMessage.message ?? "比較に失敗しました");
        } else if (statusMessage.message) {
          setStatus(status, statusMessage.message, "busy");
        }
        return false;
      }

      if (candidate.type !== MSG_DISCOVERY_RESULT) return false;
      const result = message as DiscoveryResultMessage;
      if (!result.ok) {
        fail(FAILURE_MESSAGES[result.failureCode] ?? result.message ?? "比較に失敗しました");
        return false;
      }
      if (result.kind === "candidates") {
        busy = false;
        button.disabled = false;
        clearDynamic(panel);
        setStatus(status, FAILURE_MESSAGES.discovery_ambiguous, "idle");
        renderCandidates(panel, result.candidates, (selected) => {
          void selectCandidate(selected);
        });
        return false;
      }

      renderCompare(panel, result, source);
      detach();
      busy = false;
      button.disabled = false;
      setStatus(status, "比較完了", "ok");
      return false;
    };
    addListener(listener);

    const message: DiscoveryStartMessage = {
      type: MSG_DISCOVERY_START,
      sessionId,
      source,
      cid: row.cid,
      title: row.title || row.cid,
      maker: row.maker,
      pageUrl: typeof location !== "undefined" ? location.href : "",
      originTiers: finalPriceTiers(finalPrice),
    };
    void sendStart(message)
      .then((reply) => {
        if (!reply?.ok) {
          fail(
            FAILURE_MESSAGES[(reply?.error as DiscoveryFailureCode) ?? "discovery_invalid_request"] ??
              String(reply?.error ?? "比較に失敗しました"),
          );
        }
      })
      .catch(() => fail("相手ストアの検索を開始できませんでした"));
  };

  button.onclick = (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    start();
  };
}
