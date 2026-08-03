// samples/dlsite-sales.json の workno を使って product.json を取り、メタデータを集める。
// product.json は公開 API(未ログイン 200、#4 実測)なのでブラウザ不要 — ここだけは curl 相当で済む。
//
//   node fetch-dlsite-meta.mjs
//
// 出力: samples/dlsite-product.json(.gitignore 済み)

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLES = join(dirname(fileURLToPath(import.meta.url)), "samples");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEEP = [
  "workno",
  "work_name",
  "work_name_kana",
  "maker_name",
  "maker_id",
  "circle_id",
  "series_id",
  "series_name",
  "title_id",
  "title_name",
  "work_type",
  "age_category",
  "is_pack_child",
  "is_pack_parent",
  "work_pack_parent",
  "work_pack_children",
];

async function one(workno) {
  const url = `https://www.dlsite.com/maniax/api/=/product.json?workno=${encodeURIComponent(workno)}&locale=ja-JP`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
      if (r.status === 404) return { workno, error: "404" };
      if (!r.ok) throw new Error("status " + r.status);
      const p = await r.json();
      const w = Array.isArray(p) ? p[0] : p[workno] || p;
      if (!w || !w.workno) return { workno, error: "empty" };
      return Object.fromEntries(KEEP.map((k) => [k, w[k]]));
    } catch (e) {
      if (attempt === 2) return { workno, error: String(e) };
      await sleep(1000 * (attempt + 1));
    }
  }
}

const sales = JSON.parse(readFileSync(join(SAMPLES, "dlsite-sales.json"), "utf8"));
const worknos = sales.items.map((i) => i.workno);
console.error(`fetching ${worknos.length} product.json ...`);

const items = new Array(worknos.length);
let next = 0;
let done = 0;
await Promise.all(
  Array.from({ length: 3 }, async () => {
    while (next < worknos.length) {
      const i = next++;
      items[i] = await one(worknos[i]);
      if (++done % 50 === 0) console.error(`  ${done}/${worknos.length}`);
      await sleep(120); // 相手サーバへの礼儀
    }
  }),
);

const errors = items.filter((i) => i.error);
writeFileSync(
  join(SAMPLES, "dlsite-product.json"),
  JSON.stringify({ source: "dlsite_product", count: items.length, items }),
);
console.error(`done. ${items.length} items, ${errors.length} errors`);
