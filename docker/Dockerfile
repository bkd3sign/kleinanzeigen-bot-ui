# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source
COPY src/ ./src/
COPY public/ ./public/
COPY next.config.ts tsconfig.json ./

# Build standalone output
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Stage 2: Runner (Debian Trixie for glibc ≥2.38 required by bot binary)
FROM node:22-bookworm AS node-source
FROM debian:trixie-slim AS runner

# Copy Node.js from official image
COPY --from=node-source /usr/local/bin/node /usr/local/bin/node

ARG TARGETARCH

# Install Chromium, curl, and fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    curl \
    fonts-liberation \
    fonts-noto-color-emoji \
    gosu \
    matchbox-window-manager \
    nginx-light \
    procps \
    python3-websockify \
    tigervnc-standalone-server \
    && rm -rf /var/lib/apt/lists/*

# Vendor noVNC static files (avoids the novnc apt package which drags in a second Node.js)
RUN curl -fSL https://github.com/novnc/noVNC/archive/refs/tags/v1.6.0.tar.gz -o /tmp/novnc.tgz \
    && mkdir -p /usr/share/novnc \
    && tar xzf /tmp/novnc.tgz -C /usr/share/novnc --strip-components=1 \
        --exclude='*/docs' --exclude='*/tests' --exclude='*/snap' \
    && rm /tmp/novnc.tgz

# Download kleinanzeigen-bot binary into a user-writable location
# so the in-app self-update (POST /api/bot/update-bot) can replace it at runtime.
# Intentionally the rolling 'latest' tag: the app is meant to always ship the newest bot (and
# supports in-app bot updates via Admin → Bot-Update). Trade-off: rebuilds are NOT reproducible —
# identical source on different days can embed different bot binaries. Override at build time
# (--build-arg BOT_RELEASE=<dated-tag>) if a deterministic, pinned build is required.
ARG BOT_RELEASE=latest
RUN mkdir -p /opt/bot-default \
    && curl -fSL "https://github.com/Second-Hand-Friends/kleinanzeigen-bot/releases/download/${BOT_RELEASE}/kleinanzeigen-bot-linux-${TARGETARCH}" \
    -o /opt/bot-default/kleinanzeigen-bot \
    && chmod +x /opt/bot-default/kleinanzeigen-bot \
    && /opt/bot-default/kleinanzeigen-bot version

# Create non-root user with fixed UID/GID (Chromium refuses to run as root).
# Deterministic IDs prevent permission issues when rebuilding the image
# while volume data from a previous build persists.
ARG PUID=1000
ARG PGID=1000
RUN groupadd -g ${PGID} botuser && useradd -u ${PUID} -g botuser -m -s /bin/bash botuser

WORKDIR /app

# Copy standalone build output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy ws package (serverExternalPackages requires it at runtime)
COPY --from=builder /app/node_modules/ws ./node_modules/ws

# Set ownership (/workspace is provided by volume mount at runtime)
RUN chown -R botuser:botuser /app

# Environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV BOT_DIR=/workspace
ENV BOT_CMD=/workspace/bot/kleinanzeigen-bot
ENV PORT=3001

EXPOSE 3000

# files are copied at the build-context root (NAS export is flat; CI/compose stage them
# via the "Prepare Docker context" cp step)
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# nginx config: same-origin proxy (port 3000 → app on 3001 + noVNC on /bot-browser/)
COPY nginx.conf /etc/nginx/nginx.conf

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:3000/api/system/ping || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]
