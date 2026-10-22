# Disruption Management System - Vite SPA + Express API in one container.
FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY . .
# The MCP deploy path stages the sources as a split tarball: that connector
# uploads file contents as JSON text, which cannot round-trip this much source
# byte-exactly. When the overlay parts are present they are reassembled and
# replace the staged copies with the exact repository bytes. The local CLI path
# never ships them and skips this step.
# Each generation uses its own prefix and deletes every earlier one first. The
# staging bucket keeps whatever a previous deploy left behind, and a re-split
# chunk changes the name set, so a glob over an old prefix would otherwise
# concatenate stale parts into this build's archive.
RUN rm -f appsrc.part-*.gz appsrc.tar.gz srcpack.part-*.gz srcpack.tar.gz; \
    if ls srcv3.part-*.gz >/dev/null 2>&1; then \
      cat srcv3.part-*.gz > srcv3.tar.gz && rm -f srcv3.part-*.gz; \
    fi; \
    if [ -f srcv3.tar.gz ]; then \
      rm -rf src && tar -xzf srcv3.tar.gz && rm -f srcv3.tar.gz; \
    fi

RUN npm install --no-audit --no-fund
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
# JSON store lives on a mounted volume so records survive restarts.
ENV DATA_DIR=/data

COPY --from=build /app/package.json /app/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=build /app/dist ./dist

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8080
CMD ["node", "dist/server.cjs"]
