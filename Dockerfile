# Blinkit Disruption - single container serving the API and the built SPA.
FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
# The platform terminates TLS in front of the container, so bind all interfaces here.
ENV HOST=0.0.0.0
ENV PORT=8080
ENV DATA_DIR=/data

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && npm ci --omit=dev --workspace server --include-workspace-root \
    && apt-get purge -y python3 make g++ && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
COPY config ./config

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8080
CMD ["node", "server/dist/index.js"]
