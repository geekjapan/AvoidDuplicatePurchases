import type { Listing } from "../api.js";
import { fetchListings } from "../api.js";

/** Issue #59: only owned DLsite / FANZA Doujin / FANZA Books listings. */
export const PRICE_COMPARISON_SOURCES = [
  "dlsite",
  "fanza_doujin",
  "fanza_books",
] as const;

export type PriceComparisonSource = (typeof PRICE_COMPARISON_SOURCES)[number];

export type MoneyTier = {
  amountMinor: number;
  currency: string;
  taxStatus: "included" | "excluded" | "unknown";
};

export type ObservationTier = "regular" | "sale" | "coupon";

export type TierCandidate = {
  source: string;
  cid: string;
  money: MoneyTier | null;
};

export type TierComparisonResult =
  | {
      status: "lowest";
      currency: string;
      taxStatus: MoneyTier["taxStatus"];
      amountMinor: number;
      winners: Array<{ source: string; cid: string }>;
    }
  | {
      status: "incomparable";
      reason: "currency_or_tax_mismatch";
    }
  | {
      status: "insufficient";
      reason: "fewer_than_two_values";
    };

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "className") node.className = value;
    else if (key === "textContent") node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isPriceComparisonSource(
  source: string,
): source is PriceComparisonSource {
  return (PRICE_COMPARISON_SOURCES as readonly string[]).includes(source);
}

/** Store brand for display; source id stays visible separately. */
export function storeBrandLabel(source: PriceComparisonSource): string {
  if (source === "dlsite") return "DLsite";
  return "FANZA";
}

export function taxStatusLabel(
  status: "included" | "excluded" | "unknown",
): string {
  if (status === "included") return "税込";
  if (status === "excluded") return "税別";
  return "税区分不明";
}

export function moneyLabel(money: MoneyTier | null): string {
  if (!money) return "未取得";
  return `${money.currency} ${money.amountMinor}（${taxStatusLabel(money.taxStatus)}・最小単位）`;
}

export function tierDisplayName(tier: ObservationTier): string {
  if (tier === "regular") return "定価/サークル設定価格";
  if (tier === "sale") return "セール/キャンペーン価格";
  return "クーポン適用後表示価格";
}

/** Keep only #59 sources; never invent title matches. */
export function filterComparisonListings(listings: Listing[]): Listing[] {
  return listings.filter((listing) => isPriceComparisonSource(listing.source));
}

export function groupByWorkId(listings: Listing[]): Map<number, Listing[]> {
  const map = new Map<number, Listing[]>();
  for (const listing of listings) {
    const group = map.get(listing.workId) ?? [];
    group.push(listing);
    map.set(listing.workId, group);
  }
  return map;
}

export function tierMoney(
  listing: Listing,
  tier: ObservationTier,
): MoneyTier | null {
  const obs = listing.priceObservation;
  if (!obs) return null;
  return obs[tier];
}

/**
 * Fail-closed tier comparison across listings of one work.
 * - Needs ≥2 non-null values to rank.
 * - All non-null values must share currency + taxStatus or result is 比較不可.
 * - Never converts currency or infers tax; never fills null from another tier.
 */
export function compareTier(candidates: TierCandidate[]): TierComparisonResult {
  const present = candidates.filter(
    (c): c is TierCandidate & { money: MoneyTier } => c.money !== null,
  );
  if (present.length < 2) {
    return { status: "insufficient", reason: "fewer_than_two_values" };
  }

  const first = present[0].money;
  for (const c of present) {
    if (
      c.money.currency !== first.currency ||
      c.money.taxStatus !== first.taxStatus
    ) {
      return { status: "incomparable", reason: "currency_or_tax_mismatch" };
    }
  }

  let lowest = present[0].money.amountMinor;
  for (const c of present) {
    if (c.money.amountMinor < lowest) lowest = c.money.amountMinor;
  }
  const winners = present
    .filter((c) => c.money.amountMinor === lowest)
    .map((c) => ({ source: c.source, cid: c.cid }));

  return {
    status: "lowest",
    currency: first.currency,
    taxStatus: first.taxStatus,
    amountMinor: lowest,
    winners,
  };
}

export function comparisonSummaryLabel(
  result: TierComparisonResult,
): string {
  if (result.status === "incomparable") {
    return "比較不可（通貨または税区分が一致しない）";
  }
  if (result.status === "insufficient") {
    return "比較対象不足（同一層の取得値が2件未満）";
  }
  const who = result.winners
    .map((w) => `${w.source}/${w.cid}`)
    .join(", ");
  return `最安: ${result.currency} ${result.amountMinor}（${taxStatusLabel(result.taxStatus)}・最小単位）— ${who}`;
}

function tierCandidates(
  listings: Listing[],
  tier: ObservationTier,
): TierCandidate[] {
  return listings.map((listing) => ({
    source: listing.source,
    cid: listing.cid,
    money: tierMoney(listing, tier),
  }));
}

function renderListingRow(listing: Listing): HTMLElement {
  const source = listing.source as PriceComparisonSource;
  const obs = listing.priceObservation;
  const row = el("tr", {
    className: "price-comparison-listing-row",
    "data-testid": "price-comparison-listing-row",
    "data-source": listing.source,
    "data-cid": listing.cid,
    "data-work-id": String(listing.workId),
  });

  const identity = el("td", {
    "data-testid": "price-comparison-identity",
  }, [
    el("div", {
      className: "price-comparison-store",
      textContent: storeBrandLabel(source),
    }),
    el("strong", { textContent: listing.title }),
    el("div", {
      className: "muted",
      "data-testid": "price-comparison-source-cid",
      textContent: `${listing.source} / ${listing.cid}`,
    }),
    el("div", {
      className: "muted",
      textContent: `メーカー: ${listing.maker ?? "未取得"}`,
    }),
  ]);

  const regularCell = el("td", {
    "data-testid": "price-comparison-tier-regular",
    "data-tier": "regular",
    "data-missing": obs?.regular ? "false" : "true",
    textContent: moneyLabel(obs?.regular ?? null),
  });
  const saleCell = el("td", {
    "data-testid": "price-comparison-tier-sale",
    "data-tier": "sale",
    "data-missing": obs?.sale ? "false" : "true",
    textContent: moneyLabel(obs?.sale ?? null),
  });
  const couponCell = el("td", {
    "data-testid": "price-comparison-tier-coupon",
    "data-tier": "coupon",
    "data-missing": obs?.coupon ? "false" : "true",
    textContent: moneyLabel(obs?.coupon ?? null),
  });
  const metaCell = el("td", {
    "data-testid": "price-comparison-observed-at",
    textContent: obs?.observedAt ?? "未取得",
  });

  row.append(identity, regularCell, saleCell, couponCell, metaCell);
  return row;
}

function renderTierSummary(
  tier: ObservationTier,
  listings: Listing[],
): HTMLElement {
  const result = compareTier(tierCandidates(listings, tier));
  const statusAttr =
    result.status === "lowest"
      ? "lowest"
      : result.status === "incomparable"
        ? "incomparable"
        : "insufficient";
  return el("div", {
    className: `price-comparison-tier-summary status-${statusAttr}`,
    "data-testid": `price-comparison-summary-${tier}`,
    "data-tier": tier,
    "data-comparison-status": statusAttr,
    textContent: `${tierDisplayName(tier)}: ${comparisonSummaryLabel(result)}`,
  });
}

function renderWorkGroup(workId: number, listings: Listing[]): HTMLElement {
  const sorted = [...listings].sort((a, b) => {
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return a.cid.localeCompare(b.cid);
  });

  const group = el("section", {
    className: "work-group price-comparison-work",
    "data-testid": "price-comparison-work-group",
    "data-work-id": String(workId),
  });

  group.append(
    el("header", {
      textContent: `作品グループ — ${sorted.length} listings（workId は内部 grouping のみ）`,
    }),
  );

  const table = el("table", {
    className: "price-comparison-table",
    "data-testid": "price-comparison-table",
  });
  table.append(
    el("thead", {}, [
      el("tr", {}, [
        el("th", { textContent: "ストア / 商品" }),
        el("th", { textContent: tierDisplayName("regular") }),
        el("th", { textContent: tierDisplayName("sale") }),
        el("th", { textContent: tierDisplayName("coupon") }),
        el("th", { textContent: "観測時刻" }),
      ]),
    ]),
  );
  const tbody = el("tbody");
  for (const listing of sorted) {
    tbody.append(renderListingRow(listing));
  }
  table.append(tbody);
  group.append(table);

  const summary = el("div", {
    className: "price-comparison-summaries",
    "data-testid": "price-comparison-summaries",
  });
  for (const tier of ["regular", "sale", "coupon"] as const) {
    summary.append(renderTierSummary(tier, sorted));
  }
  group.append(summary);

  return group;
}

/**
 * Admin price comparison for issue #59.
 * Uses only persisted Listing.priceObservation via GET /api/listings.
 * No provider fetch, credentials, crawl, or purchase mutation.
 */
export async function renderPriceComparison(root: HTMLElement): Promise<void> {
  root.replaceChildren(
    el("div", { className: "panel" }, [
      el("h2", { textContent: "FANZA / DLsite 価格比較" }),
      el("p", {
        className: "muted",
        "data-testid": "price-comparison-boundary",
        textContent:
          "同一 workId の保有 listing について、保存済みの可視DOM価格観測（priceObservation）だけを比較します。対象は dlsite / fanza_doujin / fanza_books のみ。未取得層は推測せず「未取得」と表示し、通貨または税区分が一致しない価格は「比較不可」とします。手動同期で得た観測の読み取り専用表示であり、プロバイダ取得・Cookie/資格情報・バックグラウンド巡回・購入/カート/クーポン操作は行いません。",
      }),
    ]),
  );

  const statusRegion = el("div", {
    className: "status-region",
    role: "status",
    "aria-live": "polite",
    "aria-atomic": "true",
    "data-testid": "price-comparison-status",
  });
  const resultsHost = el("div", {
    className: "panel",
    "data-testid": "price-comparison-results",
  });
  root.append(statusRegion, resultsHost);

  function setStatus(
    message: string,
    kind: "info" | "success" | "error" = "info",
  ): void {
    statusRegion.textContent = message;
    statusRegion.className = `status-region status-${kind}`;
    statusRegion.setAttribute("data-kind", kind);
    if (kind === "error") {
      statusRegion.setAttribute("role", "alert");
      statusRegion.setAttribute("aria-live", "assertive");
    } else {
      statusRegion.setAttribute("role", "status");
      statusRegion.setAttribute("aria-live", "polite");
    }
  }

  setStatus("保有 listing の価格観測を読み込み中…");
  try {
    const data = await fetchListings({});
    const comparable = filterComparisonListings(data.listings);
    const excludedCount = data.listings.length - comparable.length;
    const groups = groupByWorkId(comparable);
    const workIds = [...groups.keys()].sort((a, b) => a - b);

    resultsHost.replaceChildren();
    if (workIds.length === 0) {
      resultsHost.append(
        el("p", {
          className: "empty",
          "data-testid": "price-comparison-empty",
          textContent:
            "比較対象（dlsite / fanza_doujin / fanza_books）の保有 listing がありません。",
        }),
      );
      setStatus(
        excludedCount > 0
          ? `対象 listing 0 件（他ソース ${excludedCount} 件は比較から除外）。`
          : "比較できる listing がありません。",
      );
      return;
    }

    for (const workId of workIds) {
      const listings = groups.get(workId) ?? [];
      resultsHost.append(renderWorkGroup(workId, listings));
    }

    setStatus(
      `作品グループ ${workIds.length} 件・対象 listing ${comparable.length} 件を表示` +
        (excludedCount > 0
          ? `（除外ソース ${excludedCount} 件）`
          : "") +
        "。",
      "success",
    );
  } catch (err) {
    resultsHost.replaceChildren(
      el("p", {
        className: "empty",
        "data-testid": "price-comparison-empty",
        textContent: "読み込みに失敗しました。",
      }),
    );
    setStatus(errorMessage(err), "error");
  }
}
