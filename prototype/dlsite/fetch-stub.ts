// DLsite 取得スタブ(Issue #4)— セレクタ+パースの最小コード。
// Node 18+ / `npx tsx fetch-stub.ts` でセルフチェック(未ログインで可能な範囲)。

export const WORKNO_RE = /[BRV][JE]\d{6,8}/;

// ---- (2) 商品メタデータ: 未ログインで 200 を確認済み ----
export interface ProductInfo {
  workno: string;
  work_name: string;
  maker_name: string;
  circle_id: string | null;
  series_id: string | null;
  title_id: string | null;
  is_pack_child: boolean;
  is_pack_parent: boolean;
}

export async function fetchProductInfo(workno: string): Promise<ProductInfo> {
  const res = await fetch(
    `https://www.dlsite.com/maniax/api/=/product.json?workno=${workno}&locale=ja-JP`,
    { headers: { "User-Agent": "Mozilla/5.0" } },
  );
  if (!res.ok) throw new Error(`product.json ${res.status} for ${workno}`);
  const [item] = (await res.json()) as any[];
  if (!item) throw new Error(`product.json empty for ${workno}`);
  return item as ProductInfo; // 実レスポンスは255フィールド。必要分だけ型に切り出し
}

// ---- (1) 購入履歴: play.dlsite.com API(要ログインセッション Cookie)----
// 未ログインは 404 {"message":"Not Found"}。レスポンス形は survey.js の採取結果で確定させる。
export interface PurchasesPage {
  total?: number;
  limit?: number;
  offset?: number;
  works: any[]; // ponytail: フィールドはログイン後採取まで any。確定後に型を起こす
}

export async function fetchPurchasesPage(
  cookie: string,
  page: number,
): Promise<PurchasesPage> {
  const res = await fetch(`https://play.dlsite.com/api/purchases?page=${page}`, {
    headers: { "User-Agent": "Mozilla/5.0", Cookie: cookie },
  });
  if (!res.ok) throw new Error(`purchases ${res.status}(未ログインだと404)`);
  return (await res.json()) as PurchasesPage;
}

// ---- (3) カート: www.dlsite.com/maniax/cart の DOM パース ----
// アイテムは <ul class="cart_list"> に動的挿入され data-workno を持つ(ページ内JSの参照から確認)。
// ブラウザ(content script / コンソール)側で実行する想定。
export function parseCartDom(doc: Document): { workno: string; packType?: string }[] {
  return [...doc.querySelectorAll<HTMLElement>(".cart_list [data-workno]")].map(
    (el) => ({
      workno: el.dataset.workno!,
      packType: el.dataset.packType, // data-pack-type(親子パック判定に使われている)
    }),
  );
}

// ---- (1') 購入履歴 HTML フォールバック: mypage/userbuy(未ログインは302)----
// セレクタは調査資料(darekasan/dlsite-userbuy)由来。ログイン後 survey.js で現行性を確認するまで未検証。
export const USERBUY_SELECTORS = {
  page: (n: number) =>
    `https://www.dlsite.com/maniax/mypage/userbuy/=/type/all/start/all/sort/1/order/1/page/${n}`,
  lastPage: ".page_no ul li:last-child a", // data-value 属性
  row: ".work_list_main tr:not(.item_name)",
  name: ".work_name",
  url: ".work_name a", // href に product_id/RJ… が入る想定
  date: ".buy_date",
  maker: ".maker_name",
  price: ".work_price",
};

// ---- セルフチェック(未ログインで検証できる範囲のみ)----
async function demo() {
  const p = await fetchProductInfo("RJ236867");
  console.assert(WORKNO_RE.test(p.workno), "workno regex", p.workno);
  console.assert(p.workno === "RJ236867", "workno roundtrip");
  console.assert(typeof p.work_name === "string" && p.work_name.length > 0, "work_name");
  console.assert(typeof p.is_pack_parent === "boolean", "pack flags present");
  const r = await fetch("https://play.dlsite.com/api/purchases?page=1", {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  console.assert(r.status === 404, "purchases unauthenticated should be 404", r.status);
  console.log("OK:", p.workno, p.work_name, "/ purchases(no auth) =", r.status);
}

if (process.argv[1]?.endsWith("fetch-stub.ts")) demo();
