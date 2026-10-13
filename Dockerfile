# Zerosoft — self-host image. SQLite in /app/data (mount a volume) or Turso via env.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# El build prerenderiza páginas estáticas; usa una base temporal.
RUN NEXTAUTH_SECRET=build-only TURSO_DATABASE_URL=file:/tmp/build.db npm run build && npm prune --omit=dev && mkdir -p public

FROM node:24-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
RUN useradd --system --uid 1001 zerosoft && mkdir -p /app/data /app/public/uploads && chown -R zerosoft /app/data /app/public/uploads
COPY --from=build --chown=zerosoft /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/public ./public
COPY --from=build /app/package.json /app/next.config.mjs ./
COPY --from=build /app/content ./content
COPY --from=build /app/messages ./messages
USER zerosoft
EXPOSE 3000
VOLUME ["/app/data", "/app/public/uploads"]
CMD ["npx", "next", "start", "-p", "3000"]
