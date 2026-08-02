// DLsite 実地採取スクリプト(Issue #4)— ログイン済みブラウザのコンソールに貼り付け。
// 実行中のページに応じて採取対象を自動で切替。出力(JSON)を Issue #4 にコメントで貼る。
(async () => {
  const out = { page: location.href, date: new Date().toISOString() };

  if (location.host === "play.dlsite.com") {
    // (1) 購入履歴 API の実形
    const res = await fetch("/api/purchases?page=1", { credentials: "include" });
    out.status = res.status;
    const j = await res.json();
    out.topLevelKeys = Object.keys(j);
    out.meta = { total: j.total, limit: j.limit, offset: j.offset };
    out.workKeys = j.works?.[0] ? Object.keys(j.works[0]) : null;
    out.firstWorkSample = j.works?.[0] ?? null; // 1件だけ全フィールド(貼る前に個人情報がないか目視)
    out.count = await (await fetch("/api/v3/content/count?last=0", { credentials: "include" })).json();
  } else if (location.pathname.startsWith("/maniax/cart")) {
    // (3) カート実 DOM(商品を1点以上入れた状態で)
    const items = [...document.querySelectorAll(".cart_list [data-workno]")];
    out.cartListChildren = document.querySelector(".cart_list")?.children.length ?? "no .cart_list";
    out.items = items.map((el) => ({ tag: el.tagName, dataset: { ...el.dataset } }));
    out.firstItemHtml = document.querySelector(".cart_list li")?.outerHTML.slice(0, 3000) ?? null;
  } else if (location.pathname.includes("/mypage/userbuy")) {
    // (1') 購入履歴 HTML のセレクタ現行性
    const sel = {
      lastPage: ".page_no ul li:last-child a",
      row: ".work_list_main tr:not(.item_name)",
      name: ".work_name", date: ".buy_date", maker: ".maker_name", price: ".work_price",
    };
    out.selectorHits = Object.fromEntries(
      Object.entries(sel).map(([k, s]) => [k, document.querySelectorAll(s).length]),
    );
    out.firstRowHtml = document.querySelector(sel.row)?.outerHTML.slice(0, 3000) ?? null;
    out.lastPageValue = document.querySelector(sel.lastPage)?.dataset.value ?? null;
  } else {
    out.error = "play.dlsite.com / maniax/cart / mypage/userbuy のいずれかのページで実行してください";
  }

  console.log(JSON.stringify(out, null, 2));
  try { copy(out); console.log("(クリップボードにコピー済み)"); } catch {}
})();
