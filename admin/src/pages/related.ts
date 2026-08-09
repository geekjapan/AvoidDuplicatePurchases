import { SOURCES, type RelatedProductsItem, type RelatedProductsResponse } from "@adp/shared";
import {
  fetchListings,
  fetchRelatedProducts,
  type Listing,
} from "../api.js";

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

function taxStatusLabel(status: "included" | "excluded" | "unknown"): string {
  if (status === "included") return "税込";
  if (status === "excluded") return "税別";
  return "税区分不明";
}

function moneyLabel(
  money: { amountMinor: number; currency: string; taxStatus: "included" | "excluded" | "unknown" } | null,
): string {
  if (!money) return "未取得";
  return `${money.currency} ${money.amountMinor}（${taxStatusLabel(money.taxStatus)}・最小単位）`;
}

function freshnessLabel(freshness: "fresh" | "stale" | "unavailable"): string {
  if (freshness === "fresh") return "取得済み（24h以内）";
  if (freshness === "stale") return "古い観測";
  return "価格なし";
}

function ownershipLabel(item: RelatedProductsItem): string {
  if (item.ownership.status === "owned") {
    const ids = item.ownership.ownedBy
      .map((o) => `${o.source}/${o.cid}`)
      .join(", ");
    return `保有済み（${ids || "source+cid"}）`;
  }
  if (item.ownership.status === "possible_duplicate") {
    const ids = item.ownership.ownedBy
      .map((o) => `${o.source}/${o.cid}`)
      .join(", ");
    return `重複の可能性（タイトル+メーカー一致: ${ids}）`;
  }
  return "未確認（未所有とは断定しない）";
}

function evidenceLabel(item: RelatedProductsItem): string {
  return item.relation.evidence
    .map((e) => {
      const values = [e.anchorValue, e.productValue].filter(Boolean).join(" → ");
      return `${e.kind}(${e.origin})${values ? `: ${values}` : ""}`;
    })
    .join(" / ");
}

function priceBlock(item: RelatedProductsItem): HTMLElement {
  const p = item.price;
  const lines = [
    `現在: ${moneyLabel(p.current)}`,
    `通常: ${moneyLabel(p.regular)}`,
    `割引率: ${p.discountPercent === null ? "未取得" : `${p.discountPercent}%`}`,
    `セール終了: ${p.saleEndsAt ?? "未取得（推測しない）"}`,
    `観測時刻: ${p.observedAt ?? "未取得"}`,
    `状態: ${freshnessLabel(p.freshness)}`,
  ];
  return el("div", {
    className: "related-price",
    "data-testid": "related-price",
    "data-freshness": p.freshness,
    textContent: lines.join(" · "),
  });
}

/**
 * Admin comparison UI for issue #47.
 * Owned listings are selected as anchors only; related rows never mix into
 * the owned library table.
 */
export async function renderRelated(root: HTMLElement): Promise<void> {
  root.replaceChildren(
    el("div", { className: "panel" }, [
      el("h2", { textContent: "関連製品・セール比較" }),
      el("p", {
        className: "muted",
        textContent:
          "保有 listing を起点に、maker / author / series / store_related の根拠がある関連候補だけを比較します。タイトル類似だけでは出しません。未保有の market offer はライブラリ行と混ぜません。",
      }),
    ]),
  );

  const controls = el("div", {
    className: "panel related-controls",
    "data-testid": "related-controls",
  });
  const statusRegion = el("div", {
    className: "status-region",
    role: "status",
    "aria-live": "polite",
    "aria-atomic": "true",
    "data-testid": "related-status",
  });
  const ownedPanel = el("div", {
    className: "panel",
    "data-testid": "related-owned-anchor",
  });
  const resultsHost = el("div", {
    className: "panel",
    "data-testid": "related-results",
  });
  root.append(controls, statusRegion, ownedPanel, resultsHost);

  const anchorSelect = el("select", {
    "data-testid": "related-anchor-select",
    "aria-label": "比較の起点（保有 listing）",
  });
  const ownedModeSelect = el("select", {
    "data-testid": "related-owned-mode",
    "aria-label": "保有済みの扱い",
  });
  ownedModeSelect.append(
    el("option", { value: "exclude", textContent: "保有/重複候補を除外（既定）" }),
    el("option", { value: "mark", textContent: "保有/重複候補を明示して表示" }),
  );
  const sortSelect = el("select", {
    "data-testid": "related-sort",
    "aria-label": "並び替え",
  });
  for (const [value, label] of [
    ["relevance", "関連度"],
    ["price_asc", "価格昇順"],
    ["discount_desc", "割引率降順"],
    ["sale_ends_asc", "セール終了が近い順"],
    ["title_asc", "タイトル昇順"],
  ] as const) {
    sortSelect.append(el("option", { value, textContent: label }));
  }
  const sourceSelect = el("select", {
    "data-testid": "related-source-filter",
    "aria-label": "候補ソース絞り込み",
  });
  sourceSelect.append(el("option", { value: "", textContent: "全ソース" }));
  for (const source of SOURCES) {
    sourceSelect.append(el("option", { value: source, textContent: source }));
  }
  const loadButton = el("button", {
    className: "primary",
    type: "button",
    "data-testid": "related-load",
    textContent: "関連候補を読み込む",
  });

  controls.append(
    el("label", {}, ["起点 listing ", anchorSelect]),
    el("label", {}, ["保有の扱い ", ownedModeSelect]),
    el("label", {}, ["並び替え ", sortSelect]),
    el("label", {}, ["ソース ", sourceSelect]),
    loadButton,
  );

  let listings: Listing[] = [];
  let pending = false;

  function setStatus(message: string, kind: "info" | "success" | "error" = "info"): void {
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

  function renderOwnedAnchor(listing: Listing | null): void {
    ownedPanel.replaceChildren(
      el("h3", { textContent: "起点（保有 listing）" }),
    );
    if (!listing) {
      ownedPanel.append(
        el("p", { className: "empty", textContent: "保有 listing がありません。" }),
      );
      return;
    }
    ownedPanel.append(
      el("div", {
        className: "related-owned-card",
        "data-testid": "related-owned-card",
        "data-source": listing.source,
        "data-cid": listing.cid,
      }, [
        el("strong", { textContent: listing.title }),
        el("div", {
          className: "muted",
          textContent: `${listing.source} / ${listing.cid}`,
        }),
        el("div", {
          className: "muted",
          textContent: `メーカー: ${listing.maker ?? "未取得"}`,
        }),
        el("div", {
          className: "muted",
          textContent: "この行は所有 listing です。下の関連候補テーブルには混ぜません。",
        }),
      ]),
    );
  }

  function renderResults(data: RelatedProductsResponse | null): void {
    resultsHost.replaceChildren(
      el("h3", { textContent: "関連候補（market offer）" }),
    );
    if (!data) {
      resultsHost.append(
        el("p", {
          className: "muted",
          textContent: "起点を選んで読み込んでください。",
        }),
      );
      return;
    }
    resultsHost.append(
      el("p", {
        className: "muted",
        "data-testid": "related-meta",
        textContent: `anchor ${data.anchor.source}/${data.anchor.cid} · 生成 ${data.generatedAt} · 件数 ${data.total}`,
      }),
    );
    if (data.warnings.length > 0) {
      resultsHost.append(
        el("p", {
          className: "muted",
          "data-testid": "related-warnings",
          textContent: `warnings: ${data.warnings
            .map((w) => `${w.source}:${w.code}`)
            .join(", ")}`,
        }),
      );
    }
    if (data.items.length === 0) {
      resultsHost.append(
        el("p", {
          className: "empty",
          "data-testid": "related-empty",
          textContent: "関連候補はありません。",
        }),
      );
      return;
    }

    const table = el("table", {
      className: "related-table",
      "data-testid": "related-table",
    });
    table.append(
      el("thead", {}, [
        el("tr", {}, [
          el("th", { textContent: "商品" }),
          el("th", { textContent: "関連根拠" }),
          el("th", { textContent: "所有状態" }),
          el("th", { textContent: "価格スナップショット" }),
        ]),
      ]),
    );
    const tbody = el("tbody");
    for (const item of data.items) {
      const titleCell = el("td", {}, [
        el("strong", { textContent: item.product.title }),
        el("div", {
          className: "muted",
          textContent: `${item.product.source} / ${item.product.cid}`,
        }),
        el("div", {
          className: "muted",
          textContent: `メーカー: ${item.product.maker ?? "未取得"}`,
        }),
      ]);
      if (item.product.productUrl) {
        const link = el("a", {
          href: item.product.productUrl,
          target: "_blank",
          rel: "noreferrer noopener",
          textContent: "商品ページ",
        });
        titleCell.append(link);
      } else {
        titleCell.append(
          el("div", { className: "muted", textContent: "商品リンク: 未取得" }),
        );
      }
      if (item.product.imageUrl) {
        titleCell.append(
          el("img", {
            src: item.product.imageUrl,
            alt: "",
            loading: "lazy",
            referrerpolicy: "no-referrer",
            className: "related-thumb",
          }),
        );
      }

      const tr = el("tr", {
        "data-testid": "related-row",
        "data-source": item.product.source,
        "data-cid": item.product.cid,
        "data-ownership": item.ownership.status,
        "data-freshness": item.price.freshness,
      });
      tr.append(
        titleCell,
        el("td", {
          "data-testid": "related-evidence",
          textContent: evidenceLabel(item),
        }),
        el("td", {
          "data-testid": "related-ownership",
          textContent: ownershipLabel(item),
        }),
        el("td", {}, [priceBlock(item)]),
      );
      tbody.append(tr);
    }
    table.append(tbody);
    resultsHost.append(table);
  }

  async function loadAnchors(): Promise<void> {
    setStatus("保有 listing を読み込み中…");
    try {
      const data = await fetchListings({});
      listings = data.listings;
      anchorSelect.replaceChildren();
      if (listings.length === 0) {
        anchorSelect.append(
          el("option", { value: "", textContent: "（保有 listing なし）" }),
        );
        renderOwnedAnchor(null);
        renderResults(null);
        setStatus("比較できる保有 listing がありません。", "info");
        return;
      }
      for (const listing of listings) {
        anchorSelect.append(
          el("option", {
            value: `${listing.source}\0${listing.cid}`,
            textContent: `${listing.title}（${listing.source}/${listing.cid}）`,
          }),
        );
      }
      renderOwnedAnchor(listings[0] ?? null);
      renderResults(null);
      setStatus(`保有 listing ${listings.length} 件。起点を選んで関連候補を読み込めます。`);
    } catch (err) {
      setStatus(errorMessage(err), "error");
    }
  }

  async function loadRelated(): Promise<void> {
    if (pending) return;
    const value = anchorSelect.value;
    if (!value) {
      setStatus("起点 listing を選択してください。", "error");
      return;
    }
    const [source, cid] = value.split("\0");
    if (!source || !cid) {
      setStatus("起点 listing が不正です。", "error");
      return;
    }
    const listing = listings.find((l) => l.source === source && l.cid === cid) ?? null;
    renderOwnedAnchor(listing);

    pending = true;
    loadButton.setAttribute("disabled", "true");
    setStatus("関連候補を読み込み中…");
    try {
      const owned = ownedModeSelect.value === "mark" ? "mark" : "exclude";
      const sort = sortSelect.value as
        | "relevance"
        | "price_asc"
        | "discount_desc"
        | "sale_ends_asc"
        | "title_asc";
      const sourceFilter = sourceSelect.value || undefined;
      const data = await fetchRelatedProducts({
        anchorSource: source,
        anchorCid: cid,
        owned,
        sort,
        source: sourceFilter,
      });
      renderResults(data);
      setStatus(`関連候補 ${data.total} 件を表示しています。`, "success");
    } catch (err) {
      renderResults(null);
      setStatus(errorMessage(err), "error");
    } finally {
      pending = false;
      loadButton.removeAttribute("disabled");
    }
  }

  loadButton.addEventListener("click", () => {
    void loadRelated();
  });
  anchorSelect.addEventListener("change", () => {
    const value = anchorSelect.value;
    const [source, cid] = value.split("\0");
    const listing =
      listings.find((l) => l.source === source && l.cid === cid) ?? null;
    renderOwnedAnchor(listing);
  });

  await loadAnchors();
}
