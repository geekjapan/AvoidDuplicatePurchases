#!/bin/sh
# ログイン済み Chrome の最前面タブで JS を実行し、window.__r を分割して読み出す。
# 前提: 表示 > 開発 / 管理 > 「Apple Events からの JavaScript を許可」がオン(手動トグルのみ)。
#
#   usage: run-js.sh <js-file|-> <out-file>
#          js-file に - を渡すと実行を省いて window.__r の読み出しだけやり直す。
#
# collect.js は先頭で window.__r='PENDING' を置き、完了時に JSON 文字列を入れる規約。
# 一発で読むと巨大文字列で osascript が詰まるので 40KB ずつ slice して連結する。
# osascript は理由不明で単発失敗することがある(実測)ので、各呼び出しをリトライする。
set -eu

JS_FILE="$1"
OUT="$2"
CHUNK=40000

osa() {
  osascript - "$1" <<'AS'
on run argv
  tell application "Google Chrome" to execute front window's active tab javascript (item 1 of argv)
end run
AS
}

# 失敗したら最大5回まで再試行。空文字が正当な戻り値になる呼び出しはここでは使わない。
run() {
  n=0
  while [ "$n" -lt 5 ]; do
    if v=$(osa "$1" 2>/dev/null) && [ -n "$v" ]; then
      printf '%s' "$v"
      return 0
    fi
    n=$((n + 1))
    sleep 1
  done
  echo "osascript failed after 5 tries" >&2
  return 1
}

if [ "$JS_FILE" != "-" ]; then
  run "$(cat "$JS_FILE"); 'started'" >/dev/null
fi

# 完了待ち。catch 漏れで前回値を掴む事故があるので collect.js 側で必ず __r を更新すること。
i=0
while [ "$(run 'window.__r === "PENDING" ? "P" : "D"')" = "P" ]; do
  i=$((i + 1))
  if [ "$i" -gt 300 ]; then echo "timeout" >&2; exit 1; fi
  sleep 2
done

LEN=$(run 'String(window.__r.length)')
: >"$OUT"
off=0
while [ "$off" -lt "$LEN" ]; do
  run "window.__r.slice($off, $off + $CHUNK)" >>"$OUT"
  off=$((off + CHUNK))
done
echo >>"$OUT"

# 取りこぼしは JSON を静かに壊すので、必ず長さで突き合わせる。
GOT=$(node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8").replace(/\n$/,"");console.log(s.length)' "$OUT")
if [ "$GOT" != "$LEN" ]; then
  echo "length mismatch: expected $LEN got $GOT" >&2
  exit 1
fi
echo "wrote $LEN chars -> $OUT" >&2
