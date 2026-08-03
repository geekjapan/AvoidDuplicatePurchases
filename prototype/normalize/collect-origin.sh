#!/bin/sh
# 1オリジンぶんの採取。タブを遷移 → collect.js を実行 → 結果は sink.mjs へ POST される。
# 前提: node sink.mjs が起動済み、Chrome の「Apple Events からの JavaScript を許可」がオン。
#
#   usage: collect-origin.sh <url>
#
# window.__r の分割読み出しはやめた(実行中に権限が落ちる/osascript が単発失敗する実測)。
# ここで読むのは "SENT 200 len=..." の短い文字列だけ。
set -eu

URL="$1"
DIR=$(cd "$(dirname "$0")" && pwd)

osa() {
  osascript - "$1" <<'AS'
on run argv
  tell application "Google Chrome" to execute front window's active tab javascript (item 1 of argv)
end run
AS
}

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

osascript - "$URL" <<'AS' >/dev/null
on run argv
  tell application "Google Chrome" to set URL of active tab of front window to (item 1 of argv)
end run
AS

i=0
while [ "$(run 'document.readyState === "complete" ? "OK" : "WAIT"')" != "OK" ]; do
  i=$((i + 1))
  [ "$i" -gt 60 ] && { echo "load timeout" >&2; exit 1; }
  sleep 1
done
sleep 2 # SPA の初期化待ち

run "$(cat "$DIR/collect.js"); 'started'" >/dev/null

i=0
while :; do
  R=$(run 'typeof window.__r === "string" ? window.__r.slice(0, 120) : "NONE"')
  case "$R" in
    SENT*|SEND_FAILED*) echo "$URL -> $R" >&2; break ;;
  esac
  i=$((i + 1))
  [ "$i" -gt 300 ] && { echo "collect timeout ($R)" >&2; exit 1; }
  sleep 2
done
