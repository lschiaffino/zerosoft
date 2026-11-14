#!/bin/bash
# zerosoft watcher (Mac mini). Corre cada minuto por launchd (ai.zerosoft.watcher):
#   1. Revisa la infraestructura que la web no ve (Railway: Postgres de Evolution, su disco, el servicio Evolution)
#      y se la informa a zerosoft (POST /api/status/report).
#   2. Aplica los arreglos conocidos sin preguntar (runbooks): reiniciar Postgres caído si hay disco, reiniciar
#      Evolution caído. Cada arreglo tiene un mínimo de tiempo entre intentos.
#   3. Si hay un incidente abierto que no se resolvió solo en unos minutos, lanza Claude Code sin interfaz con el
#      diagnóstico (incident-prompt.md) para que lo resuelva, y deja anotado en el incidente qué hizo.
# Configuración en ~/.zerosoft-watcher/env (permisos 600): STATUS_AGENT_TOKEN, STATUS_URL, REPO_DIR, RAILWAY_PROJECT.
# Nada de esto guarda secretos en el repo.

set -uo pipefail
HOME_DIR="${ZS_WATCHER_HOME:-$HOME/.zerosoft-watcher}"
ENV_FILE="$HOME_DIR/env"
STATE="$HOME_DIR/state"
LOG="$HOME_DIR/watcher.log"
mkdir -p "$STATE"
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

STATUS_URL="${STATUS_URL:-https://zerosoft.ai}"
REPO_DIR="${REPO_DIR:-$HOME/AI/zerosoftware.ai}"
RAILWAY_DIR="$HOME_DIR/railway"          # carpeta vinculada al proyecto de Railway (install.sh)
RESTART_GAP_S=900                         # 15 min entre reinicios del mismo servicio
CLAUDE_AFTER_S=180                        # el incidente tiene que llevar 3 min abierto antes de despertar a Claude
CLAUDE_GAP_S=3600                         # como mucho una sesión de Claude por incidente por hora
CLAUDE_TIMEOUT_S=1800                     # y que no dure más de 30 min

act() { if [ -n "${DRY_RUN:-}" ]; then log "dry-run: $*"; else "$@" >> "$LOG" 2>&1; fi; }
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG"; }
now() { date +%s; }

# Un solo watcher a la vez (launchd puede arrancar otro si uno tarda).
LOCK="$STATE/lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  # Lock viejo (más de 40 min): el proceso anterior murió.
  if [ $(( $(now) - $(stat -f %m "$LOCK" 2>/dev/null || echo 0) )) -gt 2400 ]; then rm -rf "$LOCK"; mkdir "$LOCK"; else exit 0; fi
fi
trap 'rm -rf "$LOCK"' EXIT

api() { # api METHOD PATH [JSON]
  local m="$1" p="$2" body="${3:-}"
  [ -z "${STATUS_AGENT_TOKEN:-}" ] && return 1
  if [ -n "$body" ]; then
    curl -s -m 20 -X "$m" -H "Authorization: Bearer $STATUS_AGENT_TOKEN" -H 'content-type: application/json' "$STATUS_URL$p" -d "$body"
  else
    curl -s -m 20 -X "$m" -H "Authorization: Bearer $STATUS_AGENT_TOKEN" "$STATUS_URL$p"
  fi
}
report() { # report COMPONENT STATUS DETAIL [METRICS_JSON]
  local metrics="${4:-null}"
  [ -n "${DRY_RUN:-}" ] && log "dry-run: report $1 $2 $3"
  api POST /api/status/report "$(python3 -I -c 'import json,sys; c,s,d,m=sys.argv[1:5]; print(json.dumps({"component":c,"status":s,"detail":d,"metrics":json.loads(m)}))' "$1" "$2" "$3" "$metrics")" >/dev/null || true
}
since() { local f="$STATE/$1"; [ -f "$f" ] && echo $(( $(now) - $(cat "$f") )) || echo 999999; }
mark() { now > "$STATE/$1"; }

# ---------- 1 y 2: Railway (Postgres, disco, Evolution) ----------
if [ -d "$RAILWAY_DIR" ] && command -v railway >/dev/null; then
  cd "$RAILWAY_DIR" || exit 0
  vol=$(railway volume list --json 2>/dev/null | python3 -I -c 'import sys,json
try:
  v=json.load(sys.stdin)["volumes"]; v=[x for x in v if x.get("serviceName")=="Postgres"][0]
  print(int(v["currentSizeMB"]), int(v["sizeMB"]))
except Exception: print("")' 2>/dev/null)
  pg=$(railway service status --service Postgres 2>/dev/null | awk -F': ' '/^Status/{print $2}')
  evo=$(railway service status --service evolution 2>/dev/null | awk -F': ' '/^Status/{print $2}')

  if [ -n "$vol" ]; then
    used=${vol% *}; size=${vol#* }; pct=$(( used * 100 / (size > 0 ? size : 1) ))
    st=up; [ $pct -ge 85 ] && st=degraded; [ $pct -ge 97 ] && st=down
    report "evolution-db-disk" "$st" "${used}MB de ${size}MB (${pct}%)" "{\"volumeUsedMB\":$used,\"volumeSizeMB\":$size}"
  fi

  case "$pg" in
    SUCCESS) report "evolution-db" up "Postgres en marcha" ;;
    "") ;;
    *)
      report "evolution-db" down "Postgres: $pg"
      # Runbook: Postgres caído con disco disponible → reiniciar (con disco lleno no sirve: lo resuelve Claude/el dueño).
      if [ -n "$vol" ] && [ "${pct:-100}" -lt 95 ] && [ "$(since restart-postgres)" -gt $RESTART_GAP_S ]; then
        log "runbook: Postgres $pg con disco al ${pct}% → reinicio"
        act railway service restart --service Postgres || act railway service redeploy --service Postgres
        mark restart-postgres
      fi
      ;;
  esac

  case "$evo" in
    SUCCESS|"") ;;
    *)
      if [ "$(since restart-evolution)" -gt $RESTART_GAP_S ]; then
        log "runbook: Evolution $evo → reinicio"
        act railway service restart --service evolution || true
        mark restart-evolution
      fi
      ;;
  esac
fi

# ---------- 3: incidentes abiertos → Claude ----------
open=$(api GET '/api/status/incidents?state=open' 2>/dev/null || true)
echo "$open" | python3 -I -c 'import sys,json
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
for i in (d if isinstance(d,list) else d.get("incidents",[])): print(i["id"], i.get("startedAt",""))' 2>/dev/null | while read -r id started; do
  [ -z "$id" ] && continue
  age=$(( $(now) - $(python3 -I -c 'import sys,datetime; print(int(datetime.datetime.fromisoformat(sys.argv[1].replace("Z","+00:00")).timestamp()))' "$started" 2>/dev/null || now) ))
  [ $age -lt $CLAUDE_AFTER_S ] && continue
  [ "$(since "claude-$id")" -lt $CLAUDE_GAP_S ] && continue
  mark "claude-$id"
  incident=$(echo "$open" | python3 -I -c 'import sys,json; d=json.load(sys.stdin); d=d if isinstance(d,list) else d.get("incidents",[]); print(json.dumps([i for i in d if str(i["id"])==sys.argv[1]][0], ensure_ascii=False, indent=1))' "$id")
  prompt="$(cat "$HOME_DIR/incident-prompt.md")

## Incidente
\`\`\`json
$incident
\`\`\`

## Últimas líneas del watcher
\`\`\`
$(tail -n 30 "$LOG")
\`\`\`"
  log "claude: incidente $id (abierto hace ${age}s)"
  api POST "/api/status/incidents/$id/notes" "{\"by\":\"watcher\",\"text\":\"Lancé a Claude en la Mac mini para resolverlo.\"}" >/dev/null || true
  out="$HOME_DIR/claude-$id-$(date +%Y%m%d%H%M).log"
  ( cd "$REPO_DIR" && perl -e 'alarm shift; exec @ARGV' "$CLAUDE_TIMEOUT_S" claude -p "$prompt" \
      --permission-mode acceptEdits \
      --allowedTools "Read" "Grep" "Glob" "Edit" "Write" "Bash(railway:*)" "Bash(gh:*)" "Bash(vercel:*)" "Bash(curl:*)" "Bash(git:*)" "Bash(cat:*)" "Bash(ls:*)" "Bash(python3:*)" \
      --add-dir "$HOME_DIR" > "$out" 2>&1 ) || true
  summary=$(tail -c 1500 "$out" | python3 -I -c 'import sys,json; print(json.dumps(sys.stdin.read()))')
  api POST "/api/status/incidents/$id/notes" "{\"by\":\"claude\",\"text\":$summary}" >/dev/null || true
  log "claude: incidente $id terminado, log en $out"
done

exit 0
