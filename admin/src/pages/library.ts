import { SOURCES } from "@adp/shared";
import {
  assignWork,
  fetchListings,
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

function groupByWork(listings: Listing[]): Map<number, Listing[]> {
  const map = new Map<number, Listing[]>();
  for (const listing of listings) {
    const group = map.get(listing.workId) ?? [];
    group.push(listing);
    map.set(listing.workId, group);
  }
  return map;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function purchasedAtLabel(listing: Listing): string {
  if (!listing.purchasedAt || listing.purchasedAtPrecision === "unknown") {
    return "未取得";
  }
  if (listing.purchasedAtPrecision === "day") return listing.purchasedAt;
  if (listing.purchasedAtPrecision === "second") {
    const date = new Date(listing.purchasedAt);
    if (!Number.isNaN(date.getTime())) return date.toLocaleString();
  }
  return "未取得";
}

function taxStatusLabel(status: "included" | "excluded" | "unknown"): string {
  if (status === "included") return "税込";
  if (status === "excluded") return "税別";
  return "税区分不明";
}

function moneyLabel(money: {
  amountMinor: number;
  currency: string;
  taxStatus: "included" | "excluded" | "unknown";
}): string {
  // Keep minor units explicit; the UI must not assume currency exponents.
  return `${money.currency} ${money.amountMinor}（${taxStatusLabel(money.taxStatus)}・最小単位）`;
}

function purchasePriceLabel(listing: Listing): string {
  return listing.purchasePrice ? moneyLabel(listing.purchasePrice) : "未取得";
}

function currentPriceLabel(listing: Listing): string {
  if (!listing.currentPrice) return "未取得";
  return `${moneyLabel(listing.currentPrice)}（取得時刻: ${listing.currentPrice.observedAt}）`;
}

function tierLabel(
  money: {
    amountMinor: number;
    currency: string;
    taxStatus: "included" | "excluded" | "unknown";
  } | null,
): string {
  return money ? moneyLabel(money) : "未取得";
}

function priceObservationLabel(listing: Listing): string {
  const obs = listing.priceObservation;
  if (!obs) {
    return [
      "定価/サークル設定価格: 未取得",
      "セール/キャンペーン価格: 未取得",
      "クーポン適用後表示価格: 未取得",
    ].join(" / ");
  }
  return [
    `定価/サークル設定価格: ${tierLabel(obs.regular)}`,
    `セール/キャンペーン価格: ${tierLabel(obs.sale)}`,
    `クーポン適用後表示価格: ${tierLabel(obs.coupon)}`,
    `観測時刻: ${obs.observedAt}`,
  ].join(" / ");
}

function imageForListing(listing: Listing): HTMLElement {
  const host = el("div", { className: "listing-image" });
  const placeholder = () => el("span", { className: "image-placeholder", textContent: "未取得" });
  if (!listing.imageUrl) {
    host.append(placeholder());
    return host;
  }
  const image = el("img", {
    src: listing.imageUrl,
    alt: listing.title,
    loading: "lazy",
    referrerpolicy: "no-referrer",
  });
  image.addEventListener("error", () => host.replaceChildren(placeholder()));
  host.append(image);
  return host;
}

function productLinkForListing(listing: Listing): Node {
  if (!listing.productUrl) return el("span", { className: "muted", textContent: "未取得" });
  return el("a", {
    href: listing.productUrl,
    target: "_blank",
    rel: "noreferrer noopener",
    textContent: "商品ページ",
  });
}

export async function renderLibrary(root: HTMLElement): Promise<void> {
  root.replaceChildren(el("div", { className: "panel" }, [
    el("h2", { textContent: "ライブラリ" }),
    el("p", {
      className: "muted",
      textContent:
        "タイトル・メーカー・ソース・cid で検索し、保存済みの価格観測（priceObservation）だけで通貨絞り込みと並び替えを行います。",
    }),
  ]));

  const filters = el("div", { className: "filters" });

  const qLabel = el("label", { for: "filter-q", textContent: "タイトル検索" });
  const qInput = el("input", {
    id: "filter-q",
    type: "search",
    placeholder: "検索（タイトル・メーカー・ソース・cid）",
    "data-testid": "filter-q",
    "aria-label": "タイトル検索",
  });

  const sourceLabel = el("label", { for: "filter-source", textContent: "ソース" });
  const sourceSelect = el("select", {
    id: "filter-source",
    "data-testid": "filter-source",
    "aria-label": "ソース",
  });
  sourceSelect.append(el("option", { value: "", textContent: "全ソース" }));
  for (const source of SOURCES) {
    sourceSelect.append(el("option", { value: source, textContent: source }));
  }

  const makerLabel = el("label", { for: "filter-maker", textContent: "メーカー" });
  const makerInput = el("input", {
    id: "filter-maker",
    type: "search",
    placeholder: "メーカー（正規化一致）",
    "data-testid": "filter-maker",
    "aria-label": "メーカー",
  });

  // Price filters/sorts touch only stored priceObservation values.
  const currencyLabel = el("label", {
    for: "filter-price-currency",
    textContent: "観測通貨",
  });
  const currencySelect = el("select", {
    id: "filter-price-currency",
    "data-testid": "filter-price-currency",
    "aria-label": "観測通貨",
  });
  currencySelect.append(el("option", { value: "", textContent: "通貨指定なし" }));
  // Visible-DOM observation is JPY-only today; keep the control exact-match only.
  currencySelect.append(el("option", { value: "JPY", textContent: "JPY" }));

  const tierLabel = el("label", {
    for: "filter-price-tier",
    textContent: "観測層",
  });
  const tierSelect = el("select", {
    id: "filter-price-tier",
    "data-testid": "filter-price-tier",
    "aria-label": "観測層",
  });
  tierSelect.append(el("option", { value: "", textContent: "層指定なし" }));
  tierSelect.append(el("option", { value: "regular", textContent: "定価/サークル設定" }));
  tierSelect.append(el("option", { value: "sale", textContent: "セール/キャンペーン" }));
  tierSelect.append(el("option", { value: "coupon", textContent: "クーポン適用後表示" }));

  const sortLabel = el("label", { for: "filter-sort", textContent: "並び替え" });
  const sortSelect = el("select", {
    id: "filter-sort",
    "data-testid": "filter-sort",
    "aria-label": "並び替え",
  });
  const sortOptions: Array<[string, string]> = [
    ["work", "作品グループ順"],
    ["title_asc", "タイトル昇順"],
    ["title_desc", "タイトル降順"],
    ["purchased_at_asc", "購入日昇順"],
    ["purchased_at_desc", "購入日降順"],
    ["price_observation_asc", "観測価格昇順"],
    ["price_observation_desc", "観測価格降順"],
  ];
  for (const [value, label] of sortOptions) {
    sortSelect.append(el("option", { value, textContent: label }));
  }

  const searchBtn = el("button", {
    className: "primary",
    textContent: "検索",
    "data-testid": "search-btn",
  });
  filters.append(
    qLabel,
    qInput,
    sourceLabel,
    sourceSelect,
    makerLabel,
    makerInput,
    currencyLabel,
    currencySelect,
    tierLabel,
    tierSelect,
    sortLabel,
    sortSelect,
    searchBtn,
  );

  const statusRegion = el("div", {
    className: "status-region",
    role: "status",
    "aria-live": "polite",
    "aria-atomic": "true",
    "data-testid": "library-status",
  });
  const listHost = el("div", { "data-testid": "library-list" });
  root.append(filters, statusRegion, listHost);

  const selected = new Set<number>();
  /** True while a load or mutation is in flight. */
  let pending = false;
  /**
   * Monotonic generation for list loads. A completed older request whose
   * generation no longer matches must not overwrite a newer response.
   */
  let loadGeneration = 0;
  let mergeBtn: HTMLButtonElement | null = null;
  const splitButtons = new Set<HTMLButtonElement>();

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

  function clearStatus(): void {
    statusRegion.textContent = "";
    statusRegion.className = "status-region";
    statusRegion.removeAttribute("data-kind");
    statusRegion.setAttribute("role", "status");
    statusRegion.setAttribute("aria-live", "polite");
  }

  /** Disable search/filter/mutation controls to prevent overlapping submission. */
  function setControlsDisabled(disabled: boolean): void {
    searchBtn.disabled = disabled;
    qInput.disabled = disabled;
    sourceSelect.disabled = disabled;
    makerInput.disabled = disabled;
    currencySelect.disabled = disabled;
    tierSelect.disabled = disabled;
    sortSelect.disabled = disabled;
    if (mergeBtn) mergeBtn.disabled = disabled;
    for (const btn of splitButtons) btn.disabled = disabled;
  }

  function selectedPriceTier(): "regular" | "sale" | "coupon" | undefined {
    const value = tierSelect.value;
    if (value === "regular" || value === "sale" || value === "coupon") return value;
    return undefined;
  }

  function selectedSort():
    | "work"
    | "title_asc"
    | "title_desc"
    | "purchased_at_asc"
    | "purchased_at_desc"
    | "price_observation_asc"
    | "price_observation_desc"
    | undefined {
    const value = sortSelect.value;
    switch (value) {
      case "work":
      case "title_asc":
      case "title_desc":
      case "purchased_at_asc":
      case "purchased_at_desc":
      case "price_observation_asc":
      case "price_observation_desc":
        return value;
      default:
        return undefined;
    }
  }

  /**
   * Every load (initial + search + post-mutation reload) shares the same
   * pending / disable / error / finally discipline. Stale generations never
   * apply DOM updates or restore controls out from under a newer load.
   */
  async function load(): Promise<void> {
    const generation = ++loadGeneration;
    pending = true;
    setControlsDisabled(true);
    listHost.replaceChildren(el("p", { className: "muted", textContent: "読み込み中…" }));
    mergeBtn = null;
    splitButtons.clear();
    try {
      const q = qInput.value.trim();
      const source = sourceSelect.value;
      const maker = makerInput.value.trim();
      const priceCurrency = currencySelect.value.trim();
      const priceTier = selectedPriceTier();
      const sort = selectedSort();
      // Client-side guard: price sorts need currency + tier (server also rejects).
      if (
        (sort === "price_observation_asc" || sort === "price_observation_desc") &&
        (!priceCurrency || !priceTier)
      ) {
        if (generation !== loadGeneration) return;
        listHost.replaceChildren();
        setStatus(
          "観測価格で並び替えるには、観測通貨と観測層の両方を指定してください。",
          "error",
        );
        return;
      }
      const data = await fetchListings({
        q: q || undefined,
        source: source || undefined,
        maker: maker || undefined,
        priceCurrency: priceCurrency || undefined,
        priceTier,
        sort: sort && sort !== "work" ? sort : undefined,
      });
      if (generation !== loadGeneration) return;
      renderListings(data.listings);
    } catch (err) {
      if (generation !== loadGeneration) return;
      listHost.replaceChildren();
      setStatus(errorMessage(err), "error");
    } finally {
      if (generation === loadGeneration) {
        pending = false;
        setControlsDisabled(false);
      }
    }
  }

  function renderListings(listings: Listing[]): void {
    listHost.replaceChildren();
    mergeBtn = null;
    splitButtons.clear();
    if (listings.length === 0) {
      listHost.append(el("p", { className: "empty", textContent: "該当する listing がありません。" }));
      return;
    }

    const actions = el("div", { className: "filters" });
    const nextMergeBtn = el("button", {
      className: "primary",
      textContent: "選択を結合",
      "data-testid": "merge-btn",
    });
    mergeBtn = nextMergeBtn;
    nextMergeBtn.addEventListener("click", () => {
      void (async () => {
        if (pending) return;
        const picked = listings.filter((l) => selected.has(l.id));
        if (picked.length < 2) {
          setStatus("結合するには2件以上選択してください。", "error");
          return;
        }
        pending = true;
        setControlsDisabled(true);
        clearStatus();
        try {
          // Explicit merge onto the lowest existing work among the selection.
          const targetWorkId = Math.min(...picked.map((l) => l.workId));
          for (const listing of picked) {
            await assignWork(listing.source, listing.cid, {
              workId: targetWorkId,
              lock: true,
            });
          }
          selected.clear();
          setStatus("選択した listing を結合しました。", "success");
          // load() re-applies pending/disable and owns the final restore.
          await load();
        } catch (err) {
          setStatus(errorMessage(err), "error");
          pending = false;
          setControlsDisabled(false);
        }
      })();
    });
    actions.append(nextMergeBtn);
    listHost.append(actions);

    const groups = groupByWork(listings);
    for (const [workId, items] of groups) {
      const group = el("section", {
        className: "work-group",
        "data-work-id": String(workId),
      });
      group.append(
        el("header", { textContent: `作品グループ（${items.length} 件）` }),
      );
      for (const listing of items) {
        const accessibleName = `選択: ${listing.title}（${listing.source} / ${listing.cid}）`;
        const checkbox = el("input", {
          type: "checkbox",
          "data-testid": `select-${listing.cid}`,
          "aria-label": accessibleName,
        });
        checkbox.checked = selected.has(listing.id);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selected.add(listing.id);
          else selected.delete(listing.id);
        });
        const splitAccessibleName = `分離: ${listing.title}（${listing.source} / ${listing.cid}）`;
        const splitBtn = el("button", {
          textContent: "分離",
          "data-testid": `split-${listing.cid}`,
          "aria-label": splitAccessibleName,
        });
        splitButtons.add(splitBtn);
        splitBtn.addEventListener("click", () => {
          void (async () => {
            if (pending) return;
            pending = true;
            setControlsDisabled(true);
            clearStatus();
            try {
              // Server allocates a fresh work id transactionally; client never invents one.
              await assignWork(listing.source, listing.cid, {
                allocateNew: true,
                lock: true,
              });
              setStatus("listing を分離しました。", "success");
              await load();
            } catch (err) {
              setStatus(errorMessage(err), "error");
              pending = false;
              setControlsDisabled(false);
            }
          })();
        });
        const row = el("div", {
          className: `listing-row${listing.workIdLocked ? " locked" : ""}`,
          "data-cid": listing.cid,
          "data-work-id": String(listing.workId),
        });
        row.append(
          checkbox,
          el("div", { className: "listing-content" }, [
            imageForListing(listing),
            el("div", { className: "listing-details" }, [
              el("strong", { textContent: listing.title }),
              el("div", { className: "muted", textContent: `${listing.source} / ${listing.cid}` }),
              el("div", { className: "muted", textContent: listing.maker ?? "未取得" }),
              el("div", { className: "muted", textContent: `購入日: ${purchasedAtLabel(listing)}` }),
              el("div", { className: "muted" }, [
                `購入価格: ${purchasePriceLabel(listing)} / 現在価格: ${currentPriceLabel(listing)}`,
              ]),
              el("div", {
                className: "muted",
                textContent: priceObservationLabel(listing),
              }),
              el("div", { className: "muted listing-product-link" }, [
                "商品: ",
                productLinkForListing(listing),
              ]),
            ]),
          ]),
          listing.workIdLocked
            ? el("span", { className: "muted", textContent: "locked" })
            : document.createComment(""),
          splitBtn,
        );
        group.append(row);
      }
      listHost.append(group);
    }
  }

  searchBtn.addEventListener("click", () => {
    // Disabled controls block user double-submit (incl. synthetic events).
    // If a programmatic caller re-enables and overlaps, loadGeneration drops
    // the stale response so older completions never overwrite newer ones.
    if (searchBtn.disabled) return;
    clearStatus();
    void load();
  });

  // Initial load uses the same pending/error/finally discipline as every load.
  await load();
}
