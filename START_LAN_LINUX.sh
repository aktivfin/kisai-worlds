#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"; cd "$ROOT"
command -v node >/dev/null 2>&1 || { echo "Node.js 20+ не найден."; exit 1; }
[ -f data/config.json ] || cp data/config.example.json data/config.json
PORT="$(node -e "try{console.log(require('./data/config.json').port||8787)}catch(e){console.log(8787)}")"
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "Local: http://localhost:${PORT}"; [ -n "${IP:-}" ] && echo "Friends: http://${IP}:${PORT}"
exec node server.mjs
