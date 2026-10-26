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
# srcv3 is the full tree; deltav1 carries only the files changed since and is
# unpacked over it, so a small change does not cost a full re-upload.
RUN rm -f appsrc.part-*.gz appsrc.tar.gz srcpack.part-*.gz srcpack.tar.gz; \
    if ls srcv3.part-*.gz >/dev/null 2>&1; then \
      cat srcv3.part-*.gz > srcv3.tar.gz && rm -f srcv3.part-*.gz; \
    fi; \
    if [ -f srcv3.tar.gz ]; then \
      rm -rf src && tar -xzf srcv3.tar.gz && rm -f srcv3.tar.gz; \
    fi; \
    if ls deltav1.part-*.gz >/dev/null 2>&1; then \
      cat deltav1.part-*.gz > deltav1.tar.gz && rm -f deltav1.part-*.gz; \
    fi; \
    if [ -f deltav1.tar.gz ]; then \
      tar -xzf deltav1.tar.gz && rm -f deltav1.tar.gz; \
    fi; \
    if ls deltav2.part-*.gz >/dev/null 2>&1; then \
      cat deltav2.part-*.gz > deltav2.tar.gz && rm -f deltav2.part-*.gz; \
    fi; \
    if [ -f deltav2.tar.gz ]; then \
      tar -xzf deltav2.tar.gz && rm -f deltav2.tar.gz; \
    fi; \
    if ls deltav3.part-*.gz >/dev/null 2>&1; then \
      cat deltav3.part-*.gz > deltav3.tar.gz && rm -f deltav3.part-*.gz; \
    fi; \
    if [ -f deltav3.tar.gz ]; then \
      tar -xzf deltav3.tar.gz && rm -f deltav3.tar.gz; \
    fi; \
    if ls deltav4.part-*.gz >/dev/null 2>&1; then \
      cat deltav4.part-*.gz > deltav4.tar.gz && rm -f deltav4.part-*.gz; \
    fi; \
    if [ -f deltav4.tar.gz ]; then \
      tar -xzf deltav4.tar.gz && rm -f deltav4.tar.gz; \
    fi; \
    if ls deltav5.part-*.gz >/dev/null 2>&1; then \
      cat deltav5.part-*.gz > deltav5.tar.gz && rm -f deltav5.part-*.gz; \
    fi; \
    if [ -f deltav5.tar.gz ]; then \
      tar -xzf deltav5.tar.gz && rm -f deltav5.tar.gz; \
    fi; \
    if ls deltav6.part-*.gz >/dev/null 2>&1; then \
      cat deltav6.part-*.gz > deltav6.tar.gz && rm -f deltav6.part-*.gz; \
    fi; \
    if [ -f deltav6.tar.gz ]; then \
      tar -xzf deltav6.tar.gz && rm -f deltav6.tar.gz; \
    fi; \
    if ls deltav7.part-*.gz >/dev/null 2>&1; then \
      cat deltav7.part-*.gz > deltav7.tar.gz && rm -f deltav7.part-*.gz; \
    fi; \
    if [ -f deltav7.tar.gz ]; then \
      tar -xzf deltav7.tar.gz && rm -f deltav7.tar.gz; \
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
