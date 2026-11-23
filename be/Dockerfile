ARG NODE_BUILD_IMAGE=node:22-bookworm-slim
FROM ${NODE_BUILD_IMAGE} AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY be/package*.json ./
RUN npm ci --no-audit --no-fund
COPY be/ ./
RUN DATABASE_URL=postgresql://build:build@127.0.0.1/build npx prisma generate && npm run build

FROM build AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]

FROM build AS production-dependencies
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production TZ=UTC
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY be/package*.json ./
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/assets ./assets
RUN mkdir -p storage/report-exports .private-storage && chown node:node storage storage/report-exports .private-storage
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=10s --start-period=60s --retries=5 CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
