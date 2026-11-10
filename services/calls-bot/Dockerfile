# zerosoft calls bot: Node + Chromium (Playwright) + Xvfb + PulseAudio + ffmpeg.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PORT=8080 \
    XDG_RUNTIME_DIR=/tmp/runtime-bot \
    CALLS_BOT_TMP=/tmp/zs-calls-bot

WORKDIR /app
COPY package.json package-lock.json ./

# Chromium (same build as playwright-core 1.64.0) with its system deps, then
# the capture tools. No headless shell: the bot runs headful on Xvfb.
RUN npm ci --omit=dev --no-audit --no-fund \
 && npx playwright-core install --with-deps --no-shell chromium \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      xvfb xauth pulseaudio pulseaudio-utils ffmpeg tini ca-certificates \
      fonts-liberation fonts-noto-core fonts-noto-color-emoji \
 && rm -rf /var/lib/apt/lists/* /root/.npm \
 && useradd --create-home --uid 1001 --shell /usr/sbin/nologin bot \
 && mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix

COPY . .
RUN chmod 0755 /app/entrypoint.sh

USER bot
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "-s", "--", "/app/entrypoint.sh"]
