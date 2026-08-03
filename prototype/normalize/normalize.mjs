// 表記揺れ正規化の検証(Issue #7)。samples/ の実データを読み、正規化ルールを層ごとに
// 積み上げて「どの層が何組のサイト横断ペアを新たに拾うか」を測る。依存なし。
//
//   node normalize.js --selftest   ルール単体のセルフチェック(サンプル不要)
//   node normalize.js              samples/ を読んで測定 + レビュー用ペア一覧を出力
//
// samples/ は実購入データなので .gitignore 済み。ここに実タイトルを書かないこと。

import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SAMPLES = join(dirname(fileURLToPath(import.meta.url)), "samples");

// ---------------------------------------------------------------- 正規化ルール

/** L1: NFKC + 小文字化 + 空白潰し。全角英数・半角カナ・互換漢字がここで揃う。 */
export const l1 = (s) =>
  s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

export const BRACKETS = /[【\[（(〔《「『][^】\]）)〕》」』]{0,30}[】\]）)〕》」』]/g;

/**
 * 却下されたルール: ブラケットを一律除去する。実データで偽陽性が爆発したので使わない。
 * 同人音声は識別情報そのものが 【】 の中にある(演者名・使用玩具)ため、除去すると
 * シリーズ全体が1つの鍵に潰れて総当たりで一致する。計測結果は README を参照。
 */
export function stripAllBrackets(s) {
  const stripped = s.replace(BRACKETS, " ").replace(/\s+/g, " ").trim();
  return stripped.length ? stripped : s;
}

/**
 * L2: 店舗固有の版マーカーだけを落とす。同じ作品が店舗ごとに違う版名を付けられている
 * ケース(【FANZA限定版】の有無)を吸収する。中身が識別情報になりうるブラケットは触らない。
 *
 * 「無料お試し版」「無料版」は別商品(体験版を持っていても本編を買ったことにならない)なので
 * 意図的に対象外。除去すると本編と体験版が同一視され、買っていない物を購入済みと誤報する。
 */
const STORE_MARKER = /^(fanza|dlsite|dmm)?\s*(限定版|限定|専売|先行版|独占)$|^dl版$|^電子(書籍)?版$/i;
export function l2(s) {
  const stripped = s
    .replace(BRACKETS, (m) => (STORE_MARKER.test(m.slice(1, -1).trim()) ? " " : m))
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length ? stripped : s;
}

/** L3: 記号・空白を全部落とす。文字と数字だけ残す。 */
export const l3 = (s) => s.replace(/[^\p{L}\p{N}]/gu, "");

/** L4: カタカナ→ひらがな + 長音・小書きの吸収。「ヴ」「づ/ず」等の揺れも寄せる。 */
export function l4(s) {
  let t = s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  t = t.replace(/[ー―‐−–—]/g, "");
  t = t.replace(/[ぁぃぅぇぉっゃゅょゎ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) + 1),
  );
  t = t.replace(/ゔ/g, "う").replace(/[ぢ]/g, "じ").replace(/[づ]/g, "ず");
  return t;
}

/** L5: 巻数・話数表記を落とす。「第3巻」「(3)」「vol.3」「その3」「上巻」など。 */
export function l5(s) {
  return s
    .replace(/[(（\[【]\s*\d{1,3}\s*[)）\]】]/g, "") // 括弧に数字だけ = 巻数表記
    .replace(/第?\d{1,3}(巻|話|章|部|集|冊)/g, "")
    .replace(/vol\.?\s*\d{1,3}/gi, "")
    .replace(/その\d{1,3}/g, "")
    .replace(/[上中下前後]巻/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 層を積み上げた鍵。level は 1..5。 */
export function key(title, level) {
  let t = l1(title);
  if (level >= 2) t = l2(t);
  if (level >= 5) t = l5(t); // 巻数落としは記号除去より前(「(3)」を括弧除去に食われる前に)
  if (level >= 3) t = l3(t);
  if (level >= 4) t = l4(t);
  return t;
}

/** bigram Dice 係数。完全一致で拾えなかったペアの近傍band を見るのに使う。 */
export function dice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s) => {
    const m = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let hit = 0;
  for (const [g, n] of ga) hit += Math.min(n, gb.get(g) || 0);
  return (2 * hit) / (a.length - 1 + b.length - 1);
}

// ---------------------------------------------------------------- セルフチェック

function selftest() {
  // L1: 全角英数・半角カナ
  assert.equal(l1("ＡＢＣ　１２３"), "abc 123");
  assert.equal(l1("ｱｲｳ"), "アイウ");
  // L2: 店舗版マーカーだけ落とす。識別情報を含むブラケットは残す。
  assert.equal(l2("ある作品【FANZA限定版】"), "ある作品");
  assert.equal(l2("ある作品【dl版】"), "ある作品");
  assert.equal(l2("ある作品【るう - 電マ編】"), "ある作品【るう - 電マ編】");
  assert.equal(l2("ある作品【無料お試し版】"), "ある作品【無料お試し版】"); // 体験版は別商品
  assert.equal(l2("【FANZA限定版】"), "【FANZA限定版】"); // 空になるなら元に戻す
  // 一律除去は却下ルール。シリーズが1鍵に潰れることを固定しておく。
  assert.equal(
    stripAllBrackets("作品【演者A】"),
    stripAllBrackets("作品【演者B】"),
  );
  // L3: 記号除去
  assert.equal(l3("あ・い、う!!"), "あいう");
  // L4: カナ寄せ
  assert.equal(l4("アイドル"), "あいどる");
  assert.equal(l4("ヴァンパイア"), "うあんぱいあ");
  assert.equal(l4("がっこう"), "がつこう");
  // L5: 巻数
  assert.equal(l5("作品名 第3巻"), "作品名");
  assert.equal(l5("作品名 vol.12"), "作品名");
  // 層を積んだ鍵が揺れを吸収する
  assert.equal(key("【DL版】ある作品　第1巻", 5), key("ある作品(1)", 5));
  assert.equal(key("ＡＢＣ・ものがたり", 4), key("abcモノガタリ", 4));
  // dice
  assert.ok(dice("あいうえお", "あいうえお") === 1);
  assert.ok(dice("あいうえお", "あいうえおか") > 0.8);
  assert.ok(dice("あいうえお", "まったく別物") < 0.2);
  console.log("selftest ok");
}

// ---------------------------------------------------------------- サンプル読み込み

/** samples/*.json を {source, cid, title, maker} の配列に均す。 */
function loadListings() {
  const out = [];
  const byWorkno = new Map();
  for (const f of readdirSync(SAMPLES).filter((f) => f.endsWith(".json"))) {
    const d = JSON.parse(readFileSync(join(SAMPLES, f), "utf8"));
    if (d.error) {
      console.error(`skip ${f}: ${d.error}`);
      continue;
    }
    for (const i of d.items || []) {
      if (i.error) continue;
      switch (d.source) {
        case "dlsite_sales":
          byWorkno.set(i.workno, byWorkno.get(i.workno) || {});
          break;
        case "dlsite_product":
          out.push({
            source: "dlsite",
            cid: i.workno,
            title: i.work_name,
            kana: i.work_name_kana || null,
            maker: i.maker_name || null,
            makerId: i.maker_id || null,
            seriesId: i.series_id || null,
            packParent: i.work_pack_parent || null,
            packChildren: i.work_pack_children || null,
          });
          break;
        case "fanza_doujin":
          out.push({ source: "fanza_doujin", cid: i.contentId, title: i.title, maker: i.makerName || null });
          break;
        case "fanza_books":
          out.push({
            source: "fanza_books",
            cid: i.contentId,
            title: i.title,
            maker: i.author || null,
            seriesId: i.seriesId,
            volumeNumber: i.volumeNumber,
          });
          break;
        case "fanza_video":
          out.push({ source: "fanza_video", cid: i.contentId, title: i.title, maker: null });
          break;
        case "fanza_pcgame":
          out.push({ source: "fanza_pcgame", cid: i.contentId, title: i.title, maker: i.makerName || null });
          break;
      }
    }
  }
  return out.filter((l) => l.title);
}

// ---------------------------------------------------------------- 測定

function main() {
  const listings = loadListings();
  const bySource = {};
  for (const l of listings) bySource[l.source] = (bySource[l.source] || 0) + 1;
  console.log("## 件数");
  console.log(bySource, "計", listings.length);

  console.log("\n## 層ごとの新規サイト横断ペア");
  const seen = new Set();
  const pairsByLevel = {};
  for (const level of [1, 2, 3, 4, 5]) {
    const buckets = new Map();
    for (const l of listings) {
      const k = key(l.title, level);
      if (!k) continue;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(l);
    }
    const fresh = [];
    for (const group of buckets.values()) {
      if (group.length < 2) continue;
      for (let a = 0; a < group.length; a++) {
        for (let b = a + 1; b < group.length; b++) {
          if (group[a].source === group[b].source) continue; // 同一サイト内は対象外
          const id = [group[a].source + ":" + group[a].cid, group[b].source + ":" + group[b].cid]
            .sort()
            .join("|");
          if (seen.has(id)) continue;
          seen.add(id);
          fresh.push([group[a], group[b]]);
        }
      }
    }
    pairsByLevel[level] = fresh;
    console.log(`L${level}: +${fresh.length} (累計 ${seen.size})`);
  }

  // ブラケット除去は「【第1話】」のような巻数・話数マーカーまで落とすので、
  // 別作品を同一視しうる。除去された中身が両者で食い違うペアは要注意として分ける。
  const brackets = (s) => (l1(s).match(BRACKETS) || []).map((x) => l3(x)).sort().join("|");
  const makerKey = (m) => (m ? key(m, 4) : "");

  console.log("\n## 一致ペアの内訳");
  const buckets = { safe: [], makerDiff: [], bracketDiff: [], both: [] };
  for (const level of [1, 2, 3, 4, 5]) {
    for (const [a, b] of pairsByLevel[level]) {
      const mk = makerKey(a.maker) && makerKey(b.maker) ? makerKey(a.maker) === makerKey(b.maker) : null;
      const bd = brackets(a.title) !== brackets(b.title);
      const rec = { level, a, b, makerMatch: mk, bracketDiff: bd };
      if (mk === false && bd) buckets.both.push(rec);
      else if (mk === false) buckets.makerDiff.push(rec);
      else if (bd) buckets.bracketDiff.push(rec);
      else buckets.safe.push(rec);
    }
  }
  console.log(`メーカー一致 & ブラケット中身も一致 (安全): ${buckets.safe.length}`);
  console.log(`メーカー一致だがブラケット中身が違う (要確認): ${buckets.bracketDiff.length}`);
  console.log(`ブラケットは同じだがメーカーが違う (要確認): ${buckets.makerDiff.length}`);
  console.log(`両方違う (危険): ${buckets.both.length}`);

  for (const [name, list] of Object.entries(buckets)) {
    if (name === "safe" || !list.length) continue;
    console.log(`\n### ${name}`);
    for (const r of list) {
      console.log(`- L${r.level} [${r.a.source}] ${r.a.title} / ${r.a.maker || "-"}`);
      console.log(`       [${r.b.source}] ${r.b.title} / ${r.b.maker || "-"}`);
    }
  }

  console.log("\n### safe に入ったペア(先頭20件のみ)");
  for (const r of buckets.safe.slice(0, 20)) {
    console.log(`- L${r.level} [${r.a.source}] ${r.a.title} / ${r.a.maker || "-"}`);
    console.log(`       [${r.b.source}] ${r.b.title} / ${r.b.maker || "-"}`);
  }

  // 却下ルール(ブラケット一律除去)を入れると何組に膨らむか。README の根拠。
  {
    const b = new Map();
    for (const l of listings) {
      const k = l4(l3(stripAllBrackets(l1(l.title))));
      if (!k) continue;
      if (!b.has(k)) b.set(k, []);
      b.get(k).push(l);
    }
    let n = 0;
    for (const g of b.values())
      for (let a = 0; a < g.length; a++)
        for (let c = a + 1; c < g.length; c++) if (g[a].source !== g[c].source) n++;
    console.log(`\n## 却下ルール(ブラケット一律除去)を入れた場合: ${n} 組 (採用ルールは ${seen.size} 組)`);
  }

  // 完全一致で拾えなかった近傍。閾値の当たりをつけるための帯。
  console.log("\n## 完全一致で拾えなかった近傍(L4 鍵の dice >= 0.75)");
  const keyed = listings.map((l) => ({ l, k: key(l.title, 4) })).filter((x) => x.k.length >= 4);
  const near = [];
  for (let i = 0; i < keyed.length; i++) {
    for (let jj = i + 1; jj < keyed.length; jj++) {
      const x = keyed[i];
      const y = keyed[jj];
      if (x.l.source === y.l.source) continue;
      const id = [x.l.source + ":" + x.l.cid, y.l.source + ":" + y.l.cid].sort().join("|");
      if (seen.has(id)) continue;
      const d = dice(x.k, y.k);
      if (d >= 0.75) near.push({ d, x: x.l, y: y.l });
    }
  }
  near.sort((p, q) => q.d - p.d);
  console.log(`件数: ${near.length}`);
  for (const n of near.slice(0, 60)) {
    console.log(`- ${n.d.toFixed(3)}  [${n.x.source}] ${n.x.title} / ${n.x.maker || "-"}`);
    console.log(`           [${n.y.source}] ${n.y.title} / ${n.y.maker || "-"}`);
  }
}

// 直接実行されたときだけ動かす(他のスクリプトから import して使えるように)。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--selftest")) selftest();
  else main();
}
