// 採取結果の受け口(Issue #7)。collect.js がブラウザから POST してくる JSON を samples/ に書く。
//
//   node sink.mjs        127.0.0.1:8787 で待ち受け
//
// AppleScript 経由で window.__r を分割読み出しする方式は実測で不安定だった
// (「Apple Events からの JavaScript を許可」が実行中に落ちる、osascript が単発失敗する)。
// HTTP に流せばブラウザ操作は「1オリジンにつき osascript 1回」で済む。
//
// 127.0.0.1 のみ。preflight を避けるため content-type: text/plain で受ける。

import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLES = join(dirname(fileURLToPath(import.meta.url)), "samples");
const ALLOWED = /^[a-z0-9_]+$/; // ファイル名に使うので source は厳格に検証する

createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  // Chrome の Private Network Access は公開オリジン → 127.0.0.1 の POST に preflight を要求する。
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    res.writeHead(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    let d;
    try {
      d = JSON.parse(body);
    } catch (e) {
      console.error("bad json:", String(e).slice(0, 200));
      res.writeHead(400).end("bad json");
      return;
    }
    if (d.error) {
      console.error("collector error:", d.error);
      res.writeHead(200).end("logged");
      return;
    }
    if (typeof d.source !== "string" || !ALLOWED.test(d.source)) {
      console.error("bad source:", JSON.stringify(d.source));
      res.writeHead(400).end("bad source");
      return;
    }
    const out = join(SAMPLES, d.source.replace(/_/g, "-") + ".json");
    writeFileSync(out, JSON.stringify(d));
    console.error(`${d.source}: ${d.count} items -> ${out}`);
    res.writeHead(200).end("ok");
  });
}).listen(8787, "127.0.0.1", () => console.error("sink listening on 127.0.0.1:8787"));
