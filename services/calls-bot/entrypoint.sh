#!/bin/sh
# Starts a per-user PulseAudio daemon (never exits when idle), then the bot.
set -eu

mkdir -p "$XDG_RUNTIME_DIR" "$CALLS_BOT_TMP"
chmod 700 "$XDG_RUNTIME_DIR" "$CALLS_BOT_TMP"

env -u CALLS_BOT_SECRET -u CALLS_BOT_SECRET_FILE pulseaudio --daemonize=yes --exit-idle-time=-1 --disallow-exit --system=false \
  --log-target=stderr --log-level=error || true

i=0
until pactl info >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 50 ]; then
    echo '{"level":"error","msg":"pulseaudio_not_ready"}' >&2
    exit 1
  fi
  sleep 0.2
done

exec node /app/server.js
