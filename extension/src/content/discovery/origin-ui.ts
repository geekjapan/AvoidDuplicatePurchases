import type { InterventionSource } from "@adp/shared";
import {
  MSG_DISCOVERY_RESULT,
  MSG_DISCOVERY_SELECT,
  MSG_DISCOVERY_START,
  MSG_DISCOVERY_STATUS,
  type DiscoveryCandidate,
  type DiscoveryFailureCode,
  type DiscoveryPriceTiers,
  type DiscoveryResultMessage,
  type DiscoverySource,
  type DiscoveryStartReply,
  isDiscoverySource,
} from "../../messages.js";
import { extractProductMeta } from "../meta.js";
import { extractVisiblePriceTiers } from "../price-observation.js";
import { ensureDisplayStyles } from "../styles.js";
import { approvedStoreHttpsUrl } from "../banner.js";

export const ADP_DISCOVERY_PANEL_ID = "adp-discovery-panel";

const SOURCE_LABELS: Record<DiscoverySource, string> = {
  dlsite: "DLsite",
  fanza_doujin: "FANZA同人",
};

const FAILURE_MESSAGES: Record<DiscoveryFailureCode, string> = {
  discovery_login_required: "相手ストアでログインが必要です",
  discovery_age_gate: "年齢確認をブラウザで完了してください（自動クリックはしません）",
  discovery_search_timeout: "検索ページの読み込みがタイムアウトしました",
  discovery_no_match: "同一作品候補が見つかりませんでした",
  discovery_ambiguous: "候補が複数あります。一覧から選んでください",
  discovery_product_mismatch: "遷移先の商品が一致しません",
  discovery_price_unavailable: "価格がページ上で一意に読めません",
  discovery_blocked_policy: "この操作は許可されていません",
  discovery_unsupported_source: "このストア間の自動比較は未対応です",
  discovery_invalid_request: "検索リクエストが不正です",
  discovery_no_tab: "一時タブを開けませんでした",
  discovery_url_too_long: "検索URLが長すぎるため中止しました",
  discovery_receiver_not_ready: "相手ページの読み取り準備ができませんでした",
  discovery_session_lost: "探索セッションが失われました（拡張機能の再起動など）",
  discovery_cancelled: "探索をキャンセルしました",
};

function newSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `disc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function formatTier(money: DiscoveryPriceTiers[keyof DiscoveryPriceTiers]): string {
  if (!money) return "未取得";
  const yen = money.amountMinor.toLocaleString("ja-JP");
  const tax =
    money.taxStatus === "included"
      ? "（税込）"
      : money.taxStatus === "excluded"
        ? "（税別）"
        : "";
  return `${yen}円${tax}`;
}

function canRankLowest(a: DiscoveryPriceTiers, b: DiscoveryPriceTiers): boolean {
  const pairs: Array<[typeof a.regular, typeof b.regular]> = [
    [a.regular, b.regular],
    [a.sale, b.sale],
    [a.coupon, b.coupon],
  ];
  for (const [x, y] of pairs) {
    if (!x || !y) continue;
    if (x.currency !== y.currency || x.taxStatus !== y.taxStatus) return false;
  }
  // Require at least one comparable pair with same currency+tax.
  return pairs.some(([x, y]) => x && y && x.currency === y.currency && x.taxStatus === y.taxStatus);
}

function lowestLabel(
  origin: DiscoveryPriceTiers,
  target: DiscoveryPriceTiers,
  tier: "regular" | "sale" | "coupon",
): string {
  const o = origin[tier];
  const t = target[tier];
  if (!o || !t) return "";
  if (o.currency !== t.currency || o.taxStatus !== t.taxStatus) return "";
  if (o.amountMinor < t.amountMinor) return " ← 安";
  if (t.amountMinor < o.amountMinor) return " → 安";
  return " ＝";
}

function ensurePanel(doc: Document): HTMLElement {
  ensureDisplayStyles(doc);
  let panel = doc.getElementById(ADP_DISCOVERY_PANEL_ID);
  if (panel) return panel;
  panel = doc.createElement("div");
  panel.id = ADP_DISCOVERY_PANEL_ID;
  panel.className = "adp-discovery-panel";
  const host =
    doc.querySelector("#work_name")?.parentElement ??
    doc.querySelector("h1")?.parentElement ??
    doc.body;
  host?.insertBefore(panel, host.firstChild);
  return panel;
}

function setStatus(panel: HTMLElement, text: string, kind: "idle" | "busy" | "error" | "ok"): void {
  let status = panel.querySelector<HTMLElement>(".adp-discovery-status");
  if (!status) {
    status = panel.ownerDocument!.createElement("div");
    status.className = "adp-discovery-status";
    panel.appendChild(status);
  }
  status.textContent = text;
  status.dataset.kind = kind;
}

function clearResults(panel: HTMLElement): void {
  panel.querySelector(".adp-discovery-results")?.remove();
  panel.querySelector(".adp-discovery-candidates")?.remove();
}

function renderCompare(
  panel: HTMLElement,
  result: Extract<DiscoveryResultMessage, { ok: true; kind: "compare" }>,
  originLabel: string,
): void {
  clearResults(panel);
  const doc = panel.ownerDocument!;
  const box = doc.createElement("div");
  box.className = "adp-discovery-results";

  const rankOk = canRankLowest(result.originTiers, result.targetTiers);
  const targetLabel = SOURCE_LABELS[result.targetSource];

  const title = doc.createElement("div");
  title.className = "adp-discovery-results__title";
  title.textContent = `価格比較: ${originLabel} ↔ ${targetLabel}`;
  box.appendChild(title);

  const meta = doc.createElement("div");
  meta.className = "adp-discovery-results__meta";
  const link = doc.createElement("a");
  const safe = approvedStoreHttpsUrl(result.targetProductUrl, result.targetSource);
  if (safe) {
    link.href = safe;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = result.targetTitle;
  } else {
    link.textContent = result.targetTitle;
  }
  meta.append(`相手: `, link);
  if (result.targetMaker) meta.append(` / ${result.targetMaker}`);
  box.appendChild(meta);

  const table = doc.createElement("table");
  table.className = "adp-discovery-price-table";
  const thead = doc.createElement("thead");
  thead.innerHTML = `<tr><th>層</th><th>${originLabel}</th><th>${targetLabel}</th></tr>`;
  table.appendChild(thead);
  const tbody = doc.createElement("tbody");
  for (const [key, label] of [
    ["regular", "通常"],
    ["sale", "セール"],
    ["coupon", "クーポン表示"] as const,
  ] as const) {
    const tr = doc.createElement("tr");
    const rank = rankOk
      ? lowestLabel(result.originTiers, result.targetTiers, key)
      : "";
    tr.innerHTML = `<td>${label}</td><td>${formatTier(result.originTiers[key])}</td><td>${formatTier(result.targetTiers[key])}${rank}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  box.appendChild(table);

  const note = doc.createElement("p");
  note.className = "adp-discovery-note";
  note.textContent =
    "クーポン価格は画面に表示されたクーポン適用後価格であり、確定支払額ではありません。currency/taxStatus が一致しない層は最安判定しません。null は未取得のままです。";
  box.appendChild(note);

  panel.appendChild(box);
  setStatus(panel, "比較結果を表示しました", "ok");
}

function renderCandidates(
  panel: HTMLElement,
  result: Extract<DiscoveryResultMessage, { ok: true; kind: "candidates" }>,
  sessionId: string,
  onSelect: (c: DiscoveryCandidate) => void,
): void {
  clearResults(panel);
  const doc = panel.ownerDocument!;
  const box = doc.createElement("div");
  box.className = "adp-discovery-candidates";

  const title = doc.createElement("div");
  title.className = "adp-discovery-results__title";
  title.textContent = `候補が ${result.candidates.length} 件あります（自動確定しません）`;
  box.appendChild(title);

  const list = doc.createElement("ul");
  list.className = "adp-discovery-candidate-list";
  for (const c of result.candidates) {
    const li = doc.createElement("li");
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "adp-discovery-candidate-btn";
    btn.textContent = `${c.title}${c.maker ? ` / ${c.maker}` : ""} (${c.cid})`;
    btn.addEventListener("click", () => onSelect(c));
    li.appendChild(btn);
    list.appendChild(li);
  }
  box.appendChild(list);
  panel.appendChild(box);
  setStatus(panel, FAILURE_MESSAGES.discovery_ambiguous, "idle");

  // Keep sessionId referenced for lint-free future wiring.
  void sessionId;
}

/**
 * Mount the user-initiated discovery CTA on a product page.
 * Independent of ownership lookup / price_observation.
 */
export function mountDiscoveryOriginUi(
  source: InterventionSource,
  doc: Document = document,
  pageUrl: string = typeof location !== "undefined" ? location.href : "",
): void {
  if (!isDiscoverySource(source)) {
    // Wave-1: unsupported intervention sources get no discovery UI.
    return;
  }

  const meta = extractProductMeta(source, doc);
  if (!meta) return;

  const panel = ensurePanel(doc);
  panel.replaceChildren();

  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = "adp-discovery-start-btn";
  const target = source === "dlsite" ? "FANZA同人" : "DLsite";
  btn.textContent = `相手ストア（${target}）の現在価格を自動検索して比較`;
  panel.appendChild(btn);

  const status = doc.createElement("div");
  status.className = "adp-discovery-status";
  status.dataset.kind = "idle";
  status.textContent =
    "ボタンを押したときだけ検索します（ページ読み込み時の自動検索はしません）";
  panel.appendChild(status);

  let activeSessionId: string | null = null;
  let busy = false;

  const selectCandidate = async (c: DiscoveryCandidate): Promise<void> => {
    if (!activeSessionId || busy) return;
    busy = true;
    setStatus(panel, "選択した候補の商品ページを読み取り中…", "busy");
    try {
      const reply = (await chrome.runtime.sendMessage({
        type: MSG_DISCOVERY_SELECT,
        sessionId: activeSessionId,
        productUrl: c.productUrl,
        targetSource: c.targetSource,
        cid: c.cid,
      })) as DiscoveryStartReply | undefined;
      if (!reply?.ok) {
        setStatus(
          panel,
          FAILURE_MESSAGES[(reply?.error as DiscoveryFailureCode) ?? "discovery_session_lost"] ??
            String(reply?.error ?? "failed"),
          "error",
        );
        busy = false;
      }
      // Final result arrives via MSG_DISCOVERY_RESULT push.
    } catch {
      setStatus(panel, FAILURE_MESSAGES.discovery_receiver_not_ready, "error");
      busy = false;
    }
  };

  btn.addEventListener("click", () => {
    if (busy) return;
    // Re-read meta + tiers at click time (not at page load only).
    const liveMeta = extractProductMeta(source, doc);
    if (!liveMeta) {
      setStatus(panel, "商品メタデータを取得できません", "error");
      return;
    }
    const tiers = extractVisiblePriceTiers(source, doc);
    const originTiers: DiscoveryPriceTiers = {
      regular: tiers.regular,
      sale: tiers.sale,
      coupon: tiers.coupon,
    };
    const sessionId = newSessionId();
    activeSessionId = sessionId;
    busy = true;
    clearResults(panel);
    setStatus(panel, "相手ストアを検索しています…", "busy");
    btn.disabled = true;

    void (async () => {
      try {
        const reply = (await chrome.runtime.sendMessage({
          type: MSG_DISCOVERY_START,
          sessionId,
          source,
          cid: liveMeta.cid,
          title: liveMeta.title,
          maker: liveMeta.maker,
          pageUrl,
          originTiers,
        })) as DiscoveryStartReply | undefined;
        if (!reply?.ok) {
          const code = (reply?.error as DiscoveryFailureCode) ?? "discovery_invalid_request";
          setStatus(panel, FAILURE_MESSAGES[code] ?? String(reply?.error), "error");
          busy = false;
          btn.disabled = false;
          return;
        }
        // Orchestrator continues asynchronously; result comes via push.
      } catch {
        setStatus(panel, FAILURE_MESSAGES.discovery_receiver_not_ready, "error");
        busy = false;
        btn.disabled = false;
      }
    })();
  });

  // Listen for status / result pushes from the background orchestrator.
  chrome.runtime.onMessage.addListener((message: { type?: string; sessionId?: string }) => {
    if (!message?.type) return false;
    if (message.sessionId && activeSessionId && message.sessionId !== activeSessionId) {
      return false;
    }

    if (message.type === MSG_DISCOVERY_STATUS) {
      const statusMsg = message as {
        phase?: string;
        message?: string;
        failureCode?: DiscoveryFailureCode;
      };
      if (statusMsg.phase === "failed" && statusMsg.failureCode) {
        setStatus(
          panel,
          FAILURE_MESSAGES[statusMsg.failureCode] ?? statusMsg.message ?? "失敗",
          "error",
        );
        busy = false;
        btn.disabled = false;
      } else if (statusMsg.message) {
        setStatus(panel, statusMsg.message, "busy");
      }
      return false;
    }

    if (message.type === MSG_DISCOVERY_RESULT) {
      const result = message as DiscoveryResultMessage;
      if (!result.ok) {
        setStatus(
          panel,
          FAILURE_MESSAGES[result.failureCode] ?? result.message ?? "失敗",
          "error",
        );
        busy = false;
        btn.disabled = false;
        return false;
      }
      if (result.kind === "candidates") {
        renderCandidates(panel, result, result.sessionId, (c) => {
          void selectCandidate(c);
        });
        busy = false;
        btn.disabled = false;
        return false;
      }
      if (result.kind === "compare") {
        renderCompare(panel, result, SOURCE_LABELS[source as DiscoverySource]);
        busy = false;
        btn.disabled = false;
      }
      return false;
    }
    return false;
  });
}
