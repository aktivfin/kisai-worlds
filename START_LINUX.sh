#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"; cd "$ROOT"
command -v node >/dev/null 2>&1 || { echo "Node.js 20+ не найден."; exit 1; }
[ -f data/config.json ] || cp data/config.example.json data/config.json
PORT="$(node -e "try{console.log(require('./data/config.json').port||8787)}catch(e){console.log(8787)}")"
echo "KisAI Worlds: http://localhost:${PORT}"
command -v xdg-open >/dev/null 2>&1 && (sleep 1; xdg-open "http://localhost:${PORT}" >/dev/null 2>&1 || true) &
exec node server.mjs
