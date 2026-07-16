# Claude Control — 단일 이미지 (server + 정적 web)
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY web ./web
RUN npm run build:web

FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends git curl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server ./server
COPY --from=build /app/web ./web
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh
ENV PORT=3200 DATA_DIR=/data
VOLUME /data
EXPOSE 3200
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD curl -fsS http://localhost:${PORT}/healthz || exit 1
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server/src/index.js"]
