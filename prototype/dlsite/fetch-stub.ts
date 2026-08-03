// DLsite 取得スタブ(Issue #4)— 実測で確定したエンドポイント+セレクタの最小コード。
// Node 18+ / `npx tsx fetch-stub.ts` でセルフチェック(未ログインで可能な範囲)。

export const WORKNO_RE = /[BRV][JE]\d{6,8}/;

// ---- (1) 購入履歴: /api/v3/content/sales(全件一括、last= は増分カーソル)----
// 認証はブラウザセッション Cookie。拡張からは host_permissions + credentials:'include' で自動。
export interface SaleEntry {
  workno: string;
  sales_date: string; // ISO 8601 例 "2022-06-11T14:20:07.000000Z"
}

export async function fetchSales(cookie: string, last = 0): Promise<SaleEntry[]> {
  const res = await fetch(`https://play.dlsite.com/api/v3/content/sales?last=${last}`, {
    headers: { "User-Agent": "Mozilla/5.0", Cookie: cookie },
  });
  if (!res.ok) throw new Error(`sales ${res.status}(未ログインは401)`);
  return (await res.json()) as SaleEntry[];
}

// ---- (2) 商品メタデータ: 公開 product.json(未ログインで 200・255フィールド)----
export interface ProductInfo {
  workno: string;
  work_name: string;
  work_name_kana: string | null;
  maker_name: string;
  maker_id: string | null;
  circle_id: string | null;
  series_id: string | null;
  series_name: string | null;
  title_id: string | null;
  is_pack_child: boolean;
  is_pack_parent: boolean;
  work_pack_children: unknown;
  work_pack_parent: unknown;
}

export async function fetchProductInfo(workno: string): Promise<ProductInfo> {
  const res = await fetch(
    `https://www.dlsite.com/maniax/api/=/product.json?workno=${workno}&locale=ja-JP`,
    { headers: { "User-Agent": "Mozilla/5.0" } },
  );
  if (!res.ok) throw new Error(`product.json ${res.status} for ${workno}`);
  const [item] = (await res.json()) as any[];
  if (!item) throw new Error(`product.json empty for ${workno}`);
  return item as ProductInfo;
}

// ---- (3) カート: www.dlsite.com/maniax/cart の DOM パース(実 DOM で確定)----
// アイテム = li.cart_list_item[data-workno]。同一 workno がレイアウト複製で2回現れるため dedupe 必須。
export function parseCartDom(
  doc: Document,
): { workno: string; price?: string; officialPrice?: string }[] {
  const seen = new Map<string, { workno: string; price?: string; officialPrice?: string }>();
  for (const el of doc.querySelectorAll<HTMLElement>(".cart_list li[data-workno]")) {
    const w = el.dataset.workno!;
    if (!seen.has(w))
      seen.set(w, { workno: w, price: el.dataset.price, officialPrice: el.dataset.official_price });
  }
  return [...seen.values()];
}

// ---- セルフチェック(未ログインで検証できる範囲のみ)----
async function demo() {
  const p = await fetchProductInfo("RJ236867");
  console.assert(WORKNO_RE.test(p.workno), "workno regex", p.workno);
  console.assert(p.workno === "RJ236867", "workno roundtrip");
  console.assert(typeof p.work_name === "string" && p.work_name.length > 0, "work_name");
  console.assert(typeof p.is_pack_parent === "boolean", "pack flags present");
  const sales = await fetch("https://play.dlsite.com/api/v3/content/sales?last=0", {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  console.assert(sales.status === 401, "sales unauthenticated should be 401", sales.status);
  console.log("OK:", p.workno, p.work_name, "/ sales(no auth) =", sales.status);
}

if (process.argv[1]?.endsWith("fetch-stub.ts")) demo();
