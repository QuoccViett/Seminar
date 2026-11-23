FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY fe/package*.json ./
RUN npm ci --no-audit --no-fund
COPY fe/ ./
ENV VITE_API_URL="" VITE_API_MOCKING=disabled
RUN npm run build

FROM nginx:stable-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
