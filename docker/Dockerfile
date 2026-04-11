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

ARG TARGETARCH=amd64

# Install Chromium, curl, and fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    curl \
    fonts-liberation \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# Download kleinanzeigen-bot binary into a user-writable location
# so the in-app self-update (POST /api/bot/update-bot) can replace it at runtime.
# Pin to a specific release tag to avoid unexpected breaking changes from 'latest'.
# Update BOT_RELEASE when upgrading the bot.
ARG BOT_RELEASE=latest
RUN mkdir -p /opt/bot-default \
    && curl -fSL "https://github.com/Second-Hand-Friends/kleinanzeigen-bot/releases/download/${BOT_RELEASE}/kleinanzeigen-bot-linux-${TARGETARCH}" \
    -o /opt/bot-default/kleinanzeigen-bot \
    && chmod +x /opt/bot-default/kleinanzeigen-bot \
    && /opt/bot-default/kleinanzeigen-bot version

# Create non-root user (Chromium refuses to run as root)
RUN groupadd -r botuser && useradd -r -g botuser -m -s /bin/bash botuser

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
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

EXPOSE 3000

# Install gosu for dropping privileges in entrypoint
RUN apt-get update && apt-get install -y --no-install-recommends gosu && rm -rf /var/lib/apt/lists/*

# Entrypoint fixes permissions on every start (runs as root, then drops to botuser)
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:3000/api/system/ping || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]
