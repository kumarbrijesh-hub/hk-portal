# Disruption Management System - Vite SPA + Express API in one container.
FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
# JSON store lives on a mounted volume so records survive restarts.
ENV DATA_DIR=/data

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=build /app/dist ./dist

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8080
CMD ["node", "dist/server.cjs"]
