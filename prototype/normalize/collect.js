// 正規化検証(Issue #7)用のサンプル採取。ログイン済み Chrome の該当オリジンで実行する。
// 読み取り専用 — 購入・カート・削除など書き込み系は一切叩かない。
//
// CORS の都合でオリジンごとに実行する必要がある(#5 実測)。開くタブ:
//   https://play.dlsite.com/         → 購入 workno 一覧
//   https://www.dlsite.com/maniax/   → product.json でメタ補完(window.__worknos を注入してから)
//   https://www.dmm.co.jp/dc/-/mylibrary/  → FANZA 同人
//   https://book.dmm.co.jp/library/        → FANZA ブックス
//   https://video.dmm.co.jp/                → FANZA 動画
//   https://dlsoft.dmm.co.jp/               → FANZA PCゲーム
//
// 結果は window.__r に JSON 文字列で入る(run-js.sh が分割して読み出す)。

window.__r = "PENDING";

(async () => {
  const j = async (url, init) => {
    const r = await fetch(url, Object.assign({ credentials: "include" }, init || {}));
    if (!r.ok) throw new Error(url + " -> " + r.status);
    return r.json();
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 同時実行数を絞って順に流す。相手サーバへの礼儀と、失敗を握り潰さないため。
  async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: limit }, async () => {
        while (next < items.length) {
          const i = next++;
          out[i] = await fn(items[i], i);
        }
      }),
    );
    return out;
  }

  try {
    const host = location.hostname;
    let out;

    if (window.__worknos && window.__worknos.length) {
      // product.json は play.dlsite.com からでも CORS 許可される(実測)ので host は問わない。
      const worknos = window.__worknos;
      let done = 0;
      const items = await mapLimit(worknos, 3, async (wn) => {
        await sleep(80);
        done++;
        try {
          const p = await j(
            "https://www.dlsite.com/maniax/api/=/product.json?workno=" +
              encodeURIComponent(wn) +
              "&locale=ja-JP",
          );
          const w = Array.isArray(p) ? p[0] : p[wn] || p;
          if (!w) return { workno: wn, error: "empty" };
          return {
            workno: w.workno,
            work_name: w.work_name,
            work_name_kana: w.work_name_kana,
            maker_name: w.maker_name,
            maker_id: w.maker_id,
            circle_id: w.circle_id,
            series_id: w.series_id,
            series_name: w.series_name,
            title_id: w.title_id,
            title_name: w.title_name,
            work_type: w.work_type,
            age_category: w.age_category,
            is_pack_child: w.is_pack_child,
            is_pack_parent: w.is_pack_parent,
            work_pack_parent: w.work_pack_parent,
            work_pack_children: w.work_pack_children,
          };
        } catch (e) {
          return { workno: wn, error: String(e) };
        }
      });
      out = { source: "dlsite_product", count: items.length, items };
    } else if (host === "play.dlsite.com") {
      // {workno, sales_date} が全件一括で返る(ページングなし)。
      const sales = await j("https://play.dlsite.com/api/v3/content/sales?last=0");
      out = { source: "dlsite_sales", count: sales.length, items: sales };
    } else if (host === "www.dmm.co.jp") {
      const items = [];
      for (let page = 1; page <= 50; page++) {
        const res = await j(
          "https://www.dmm.co.jp/dc/doujin/api/mylibraries/?page=" +
            page +
            "&sort=purchasedate_desc&genre=all&limit=100",
        );
        const byDate = (res.data && res.data.items) || {};
        let n = 0;
        for (const [dateKey, list] of Object.entries(byDate)) {
          for (const it of list) {
            n++;
            items.push({
              contentId: it.contentId,
              title: it.title,
              makerName: it.makerName,
              genre: it.genre,
              purchasedDateRaw: dateKey,
            });
          }
        }
        if (!n || !(res.data && res.data.hasNext)) break;
        await sleep(200);
      }
      out = { source: "fanza_doujin", count: items.length, items };
    } else if (host === "book.dmm.co.jp") {
      // 本棚はシリーズ単位でしか返らないので、シリーズごとに巻を引く N+1。
      const series = [];
      for (let page = 1; page <= 50; page++) {
        const res = await j(
          "https://book.dmm.co.jp/ajax/bff/library/?shop_name=all&page=" +
            page +
            "&order=added_desc&show_expired=0&format_webp=1",
        );
        const list = res.series_books || [];
        series.push(...list);
        const pager = res.pager || {};
        if (!list.length || page * (pager.per_page || 20) >= (pager.total_count || 0)) break;
        await sleep(200);
      }
      const items = [];
      await mapLimit(series, 2, async (s) => {
        await sleep(150);
        const sid = s.series_id || s.id;
        try {
          const res = await j(
            "https://book.dmm.co.jp/ajax/bff/contents/?shop_name=adult&series_id=" +
              encodeURIComponent(sid) +
              "&page=1&per_page=100&order=asc&purchase_status=purchased&format_webp=1",
          );
          for (const v of res.volume_books || []) {
            if (!v.purchased) continue;
            items.push({
              contentId: v.content_id,
              seriesId: String(sid),
              seriesTitle: s.title || s.series_title || null,
              title: v.title,
              volumeNumber: v.volume_number,
              author: s.author || s.author_name || (s.authors && s.authors[0] && s.authors[0].name) || null,
              purchasedDate: v.purchased.purchased_date,
            });
          }
        } catch (e) {
          items.push({ seriesId: String(sid), error: String(e) });
        }
      });
      // シリーズ側のフィールド名が実測で未確定なので、1件だけ生を残して後で確認する。
      out = { source: "fanza_books", count: items.length, items, seriesSample: series[0] || null };
    } else if (host === "video.dmm.co.jp") {
      const q = `query PurchasedContent($offset:Int!,$limit:Int!,$filter:PPVContentViewingRightsItemSummaryListFilterInput!,$sort:PPVContentViewingRightsItemSummaryListSort!){
  user{... on Member{ppvLibrary{contentViewingRightsSummaryList(filter:$filter,offset:$offset,limit:$limit,sort:$sort){
    pageInfo{hasNext totalCount}
    items{ id content{ id title floor contentType isDiscontinued } contentItem{ latestViewingRightsAcquiredAt } }
  }}}}}`;
      const items = [];
      for (let offset = 0; offset < 5000; offset += 100) {
        const res = await j("https://api.video.dmm.co.jp/graphql", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            operationName: "PurchasedContent",
            query: q,
            variables: {
              offset,
              limit: 100,
              filter: { displayStatus: "VISIBLE" },
              sort: "VIEWING_RIGHTS_ACQUIRED_AT_DESC",
            },
          }),
        });
        const l = res.data.user.ppvLibrary.contentViewingRightsSummaryList;
        for (const i of l.items) {
          items.push({ contentId: i.content.id, title: i.content.title, floor: i.content.floor });
        }
        if (!l.pageInfo.hasNext) break;
        await sleep(200);
      }
      out = { source: "fanza_video", count: items.length, items };
    } else if (host === "dlsoft.dmm.co.jp") {
      const items = [];
      for (let page = 1; page <= 50; page++) {
        const res = await j(
          "https://dlsoft.dmm.co.jp/ajax/v1/library?service=all&brand=&searchWord=&sort=order_desc&browserOnly=0&page=" +
            page,
        );
        const list = (res.body && res.body.library) || [];
        for (const i of list) {
          items.push({
            contentId: i.contentId,
            title: i.title,
            makerName: (i.brand && i.brand.name) || null,
            authors: (i.authorArray || []).map((a) => a && (a.name || a)),
          });
        }
        if (!list.length || items.length >= ((res.body && res.body.totalCount) || 0)) break;
        await sleep(200);
      }
      out = { source: "fanza_pcgame", count: items.length, items };
    } else {
      throw new Error("未対応のオリジン: " + host);
    }

    window.__r = JSON.stringify(out);
  } catch (e) {
    // catch を書かないと前回の __r が残って古い結果を掴む(#5 で踏んだ)。
    window.__r = JSON.stringify({ error: String((e && e.stack) || e) });
  }

  // sink.mjs へ送る。text/plain にして preflight を避ける(拡張ではなくページ文脈なので)。
  try {
    const r = await fetch("http://127.0.0.1:8787/", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: window.__r,
    });
    window.__r = "SENT " + r.status + " len=" + window.__r.length;
  } catch (e) {
    window.__r = "SEND_FAILED " + e + " len=" + window.__r.length;
  }
})();
