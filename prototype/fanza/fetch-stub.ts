// FANZA 取得スタブ(Issue #5)— 実測で確定したエンドポイント+レスポンス形の最小コード。
// Node 18+ / `npx tsx fetch-stub.ts` でセルフチェック(パース部分のみ。取得はセッション Cookie 必須)。
//
// 全店舗ともブラウザセッション Cookie 認証。CORS の都合で拡張の background から叩くこと
// (www.dmm.co.jp → book.dmm.co.jp の fetch はページ文脈だとブロックされる)。

import { strict as assert } from "node:assert";

/** 正規化後の1購入。purchasedAt は取れない店舗があるので nullable + 精度付き。 */
export interface Purchase {
  floor: "doujin" | "books" | "video" | "pcgame";
  contentId: string;
  title: string;
  maker: string | null;
  purchasedAt: string | null;
  /** date = 日付のみ / datetime = 秒精度 / unreliable = 一括移行等で信用できない / none = 取れない */
  dateAccuracy: "date" | "datetime" | "unreliable" | "none";
}

// ---- (1a) 同人: GET /dc/doujin/api/mylibraries/ ----
// items は「購入日文字列」をキーにしたオブジェクト。limit の上限は 100(200 は 0 件で返る)。
export const DOUJIN_LIMIT_MAX = 100;

export interface DoujinItem {
  contentId: string;
  productId: string;
  title: string;
  makerName: string;
  genre: string;
  imageSrc: string;
}
export interface DoujinLibraryPage {
  error_code: number;
  data: { items: Record<string, DoujinItem[]>; total: number; hasNext: boolean };
}

export function doujinLibraryUrl(page: number, limit = DOUJIN_LIMIT_MAX): string {
  return `https://www.dmm.co.jp/dc/doujin/api/mylibraries/?page=${page}&sort=purchasedate_desc&genre=all&limit=${Math.min(limit, DOUJIN_LIMIT_MAX)}`;
}

/** "2026年07月24日" -> "2026-07-24"。想定外の形は null(捨てずに purchasedAt=null で残す)。 */
export function parseJpDate(s: string): string | null {
  const m = /^(\d{4})年(\d{2})月(\d{2})日$/.exec(s.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function parseDoujinPage(res: DoujinLibraryPage): Purchase[] {
  const out: Purchase[] = [];
  for (const [dateKey, items] of Object.entries(res.data.items)) {
    const d = parseJpDate(dateKey);
    for (const it of items) {
      out.push({
        floor: "doujin",
        contentId: it.contentId,
        title: it.title,
        maker: it.makerName ?? null,
        purchasedAt: d,
        dateAccuracy: d ? "date" : "none",
      });
    }
  }
  return out;
}

// ---- (1b) ブックス: 本棚(シリーズ)→ シリーズごとに巻 の2段。N+1 だがシリーズ数は少ない。----
// shop_name=all は一般向け(book.dmm.com)も含む。重複購入回避の目的では all が正しい。
export function booksLibraryUrl(page: number, shop: "all" | "adult" = "all"): string {
  return `https://book.dmm.co.jp/ajax/bff/library/?shop_name=${shop}&page=${page}&order=added_desc&show_expired=0&format_webp=1`;
}
export function booksContentsUrl(seriesId: string, page = 1, shop: "all" | "adult" = "adult"): string {
  return `https://book.dmm.co.jp/ajax/bff/contents/?shop_name=${shop}&series_id=${seriesId}&page=${page}&per_page=100&order=asc&purchase_status=purchased&format_webp=1`;
}

export interface BooksVolume {
  content_id: string;
  title: string;
  volume_number: number;
  purchased: { purchased_date: string } | null;
}
export interface BooksContentsPage {
  volume_books: BooksVolume[];
  pager: { page: number; per_page: number; total_count: number };
}

/** シリーズ ID は URL 生成に必須(product/<series_id>/<content_id>/)なので一緒に返す。 */
export function parseBooksContents(
  res: BooksContentsPage,
  seriesId: string,
  author: string | null,
): (Purchase & { seriesId: string; volumeNumber: number })[] {
  return res.volume_books
    .filter((v) => v.purchased)
    .map((v) => ({
      floor: "books" as const,
      contentId: v.content_id,
      title: v.title,
      maker: author,
      purchasedAt: v.purchased!.purchased_date,
      dateAccuracy: "datetime" as const,
      seriesId,
      volumeNumber: v.volume_number,
    }));
}

export function booksProductUrl(seriesId: string, contentId: string): string {
  return `https://book.dmm.co.jp/product/${seriesId}/${contentId}/`;
}

// ---- (1c) 動画: GraphQL https://api.video.dmm.co.jp/graphql ----
// latestViewingRightsAcquiredAt は購入日ではない(一括移行で同一値になる)ため unreliable 固定。
export const VIDEO_GRAPHQL = "https://api.video.dmm.co.jp/graphql";
export const VIDEO_PURCHASED_QUERY = `query PurchasedContent($offset:Int!,$limit:Int!,$filter:PPVContentViewingRightsItemSummaryListFilterInput!,$sort:PPVContentViewingRightsItemSummaryListSort!){
  user{... on Member{ppvLibrary{contentViewingRightsSummaryList(filter:$filter,offset:$offset,limit:$limit,sort:$sort){
    pageInfo{hasNext totalCount}
    items{ id content{ id title floor contentType isDiscontinued } contentItem{ latestViewingRightsAcquiredAt } }
  }}}}}`;

export function videoPurchasedBody(offset: number, limit: number) {
  return {
    operationName: "PurchasedContent",
    query: VIDEO_PURCHASED_QUERY,
    variables: {
      offset,
      limit,
      filter: { displayStatus: "VISIBLE" },
      sort: "VIEWING_RIGHTS_ACQUIRED_AT_DESC",
    },
  };
}

export interface VideoGqlResponse {
  data: {
    user: {
      ppvLibrary: {
        contentViewingRightsSummaryList: {
          pageInfo: { hasNext: boolean; totalCount: number };
          items: {
            id: string;
            content: { id: string; title: string; floor: string };
            contentItem: { latestViewingRightsAcquiredAt: string | null };
          }[];
        };
      };
    };
  };
}

export function parseVideoPage(res: VideoGqlResponse): Purchase[] {
  return res.data.user.ppvLibrary.contentViewingRightsSummaryList.items.map((i) => ({
    floor: "video" as const,
    contentId: i.content.id,
    title: i.content.title,
    maker: null,
    purchasedAt: i.contentItem.latestViewingRightsAcquiredAt,
    dateAccuracy: "unreliable" as const,
  }));
}

// ---- (1d) PCゲーム(dlsoft): GET /ajax/v1/library ----
// deliveryBeginDate は配信開始日であって購入日ではない。購入日は取得不可。
export function pcgameLibraryUrl(page: number): string {
  return `https://dlsoft.dmm.co.jp/ajax/v1/library?service=all&brand=&searchWord=&sort=order_desc&browserOnly=0&page=${page}`;
}

export interface PcgameResponse {
  error: unknown;
  body: {
    totalCount: number;
    library: { contentId: string; title: string; brand: { name: string } | null }[];
  };
}

export function parsePcgamePage(res: PcgameResponse): Purchase[] {
  return res.body.library.map((i) => ({
    floor: "pcgame" as const,
    contentId: i.contentId,
    title: i.title,
    maker: i.brand?.name ?? null,
    purchasedAt: null,
    dateAccuracy: "none" as const,
  }));
}

// ---- (2) 商品ページからの cid 抽出(同人・ブックス = 介入対象)----
// 同人詳細は og:url / link[rel=canonical] が一致(実測)。ブックスは series_id も要る。
export function cidFromUrl(url: string): { floor: "doujin" | "books"; contentId: string; seriesId?: string } | null {
  const d = /^https:\/\/www\.dmm\.co\.jp\/dc\/doujin\/-\/detail\/=\/cid=([a-z0-9_]+)\//.exec(url);
  if (d) return { floor: "doujin", contentId: d[1] };
  const b = /^https:\/\/book\.dmm\.co\.jp\/product\/(\d+)\/([a-z0-9]+)\//.exec(url);
  if (b) return { floor: "books", contentId: b[2], seriesId: b[1] };
  return null;
}

// ---- (3) カート: 両店舗とも JSON API。DOM セレクタ不要。----
export const DOUJIN_BASKET_URL = "https://www.dmm.co.jp/dc/doujin/api/baskets/";
export const BOOKS_BASKET_URL = "https://book.dmm.co.jp/ajax/bff/basket_product_ids/";

export function parseDoujinBasket(res: { data: { content_id: string }[] }): string[] {
  return res.data.map((i) => i.content_id);
}
export function parseBooksBasket(res: { product_ids: string[] }): string[] {
  return res.product_ids;
}

// ---- セルフチェック(実測レスポンスを固定値にした最小テスト)----
if (process.argv[1]?.endsWith("fetch-stub.ts")) {
  assert.equal(parseJpDate("2026年07月24日"), "2026-07-24");
  assert.equal(parseJpDate("2026/07/24"), null);

  const doujin = parseDoujinPage({
    error_code: 0,
    data: {
      total: 1742,
      hasNext: true,
      items: {
        "2026年07月24日": [
          { contentId: "d_100001", productId: "d_100001", title: "作品A", makerName: "メーカーX", genre: "ボイス", imageSrc: "" },
          { contentId: "d_100002", productId: "d_100002", title: "作品B", makerName: "メーカーX", genre: "ボイス", imageSrc: "" },
        ],
        "壊れた日付": [
          { contentId: "d_000001", productId: "d_000001", title: "作品C", makerName: "メーカーY", genre: "CG", imageSrc: "" },
        ],
      },
    },
  });
  assert.equal(doujin.length, 3);
  assert.deepEqual(doujin[0], {
    floor: "doujin", contentId: "d_100001", title: "作品A", maker: "メーカーX",
    purchasedAt: "2026-07-24", dateAccuracy: "date",
  });
  // 日付が壊れていても購入自体は落とさない
  assert.equal(doujin[2].purchasedAt, null);
  assert.equal(doujin[2].dateAccuracy, "none");
  assert.ok(doujinLibraryUrl(1, 200).includes("limit=100"), "limit は 100 で頭打ち");

  const books = parseBooksContents(
    {
      pager: { page: 1, per_page: 100, total_count: 3 },
      volume_books: [
        { content_id: "b100xxxxx01001", title: "巻1", volume_number: 1, purchased: { purchased_date: "2023-12-30T12:00:00+09:00" } },
        { content_id: "b100xxxxx01002", title: "巻2", volume_number: 2, purchased: null }, // 未購入は落とす
      ],
    },
    "100001",
    "黒斗",
  );
  assert.equal(books.length, 1);
  assert.equal(books[0].dateAccuracy, "datetime");
  assert.equal(books[0].seriesId, "100001");
  assert.equal(
    booksProductUrl(books[0].seriesId, books[0].contentId),
    "https://book.dmm.co.jp/product/100001/b100xxxxx01001/",
  );

  const video = parseVideoPage({
    data: { user: { ppvLibrary: { contentViewingRightsSummaryList: {
      pageInfo: { hasNext: true, totalCount: 93 },
      items: [{ id: "abcd00123", content: { id: "abcd00123", title: "動画A", floor: "AV" },
                contentItem: { latestViewingRightsAcquiredAt: "2025-09-23T00:00:00Z" } }],
    } } } },
  });
  assert.equal(video[0].contentId, "abcd00123");
  assert.equal(video[0].dateAccuracy, "unreliable");
  assert.equal(videoPurchasedBody(0, 50).variables.limit, 50);

  const pcgame = parsePcgamePage({
    error: null,
    body: { totalCount: 1, library: [{ contentId: "brand_0001", title: "ゲームA", brand: { name: "メーカーZ" } }] },
  });
  assert.deepEqual(pcgame[0], {
    floor: "pcgame", contentId: "brand_0001", title: "ゲームA", maker: "メーカーZ",
    purchasedAt: null, dateAccuracy: "none",
  });

  assert.deepEqual(cidFromUrl("https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_285449/"), {
    floor: "doujin", contentId: "d_285449",
  });
  assert.deepEqual(cidFromUrl("https://book.dmm.co.jp/product/100001/b100xxxxx01001/"), {
    floor: "books", contentId: "b100xxxxx01001", seriesId: "100001",
  });
  assert.equal(cidFromUrl("https://www.dlsite.com/maniax/work/=/product_id/RJ123456.html"), null);

  assert.deepEqual(parseDoujinBasket({ data: [{ content_id: "d_100003" }, { content_id: "d_100004" }] }),
    ["d_100003", "d_100004"]);
  assert.deepEqual(parseBooksBasket({ product_ids: ["b100yyyyy00001", "b100yyyyy00002"] }),
    ["b100yyyyy00001", "b100yyyyy00002"]);

  console.log("FANZA stub self-check OK");
}
