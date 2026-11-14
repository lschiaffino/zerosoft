#!/bin/bash
# Instala el watcher en esta Mac: ~/.zerosoft-watcher (config y estado) y el LaunchAgent ai.zerosoft.watcher.
# Uso: ops/mac-watcher/install.sh <railway-project-id>
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
home="$HOME/.zerosoft-watcher"
mkdir -p "$home/state" "$home/railway"
ln -sf "$here/watcher.sh" "$home/watcher.sh"
ln -sf "$here/incident-prompt.md" "$home/incident-prompt.md"

if [ ! -f "$home/env" ]; then
  umask 077
  cat > "$home/env" <<ENV
STATUS_URL=https://zerosoft.ai
REPO_DIR=$(cd "$here/../.." && git rev-parse --path-format=absolute --git-common-dir | sed 's#/.git$##')
# STATUS_AGENT_TOKEN=  (el mismo valor que en Vercel; editá este archivo a mano, no lo pegues en ningún chat)
ENV
  chmod 600 "$home/env"
  echo "Creé $home/env: completá STATUS_AGENT_TOKEN."
fi

if [ -n "${1:-}" ]; then (cd "$home/railway" && railway link --project "$1" --environment production >/dev/null && echo "Railway vinculado."); fi

plist="$HOME/Library/LaunchAgents/ai.zerosoft.watcher.plist"
sed -e "s#__WATCHER__#$home/watcher.sh#" -e "s#__HOME__#$HOME#g" "$here/ai.zerosoft.watcher.plist" > "$plist"
launchctl bootout "gui/$(id -u)/ai.zerosoft.watcher" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
echo "Watcher instalado: corre cada minuto. Log: $home/watcher.log"
