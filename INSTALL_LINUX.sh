#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
echo "KisAI Worlds installer"
if ! command -v node >/dev/null 2>&1; then echo "Node.js 20+ не найден."; exit 1; fi
MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$MAJOR" -lt 20 ]; then echo "Нужен Node.js 20+; найден $(node -v)."; exit 1; fi
mkdir -p data "$HOME/.local/bin" "$HOME/.local/share/applications"
[ -f data/config.json ] || cp data/config.example.json data/config.json
chmod +x START_LINUX.sh START_LAN_LINUX.sh INSTALL_LINUX.sh
LAUNCHER="$HOME/.local/bin/kisai-worlds"
cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
cd "$ROOT"
exec "$ROOT/START_LINUX.sh"
EOF
chmod +x "$LAUNCHER"
DESKTOP="$HOME/.local/share/applications/kisai-worlds.desktop"
cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=KisAI Worlds
Comment=Voice-first multiplayer AI RPG
Exec=$LAUNCHER
Terminal=true
Categories=Game;RolePlaying;
StartupNotify=true
EOF
chmod +x "$DESKTOP"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$HOME/.local/share/applications" >/dev/null 2>&1 || true
echo "Установлено без root. Команда запуска: kisai-worlds"
