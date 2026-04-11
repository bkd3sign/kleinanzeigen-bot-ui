#!/usr/bin/env bash
# Packages all files needed for "docker compose up --build" on a NAS/server.
# Creates docker/export/ with everything needed for deployment.
# Usage: ./docker/build.sh

set -euo pipefail

DOCKER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$DOCKER_DIR")"
OUT_DIR="$DOCKER_DIR/export"

echo "==> Cleaning export directory..."
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

echo "==> Copying Docker files..."
cp "$DOCKER_DIR/Dockerfile"          "$OUT_DIR/Dockerfile"
cp "$DOCKER_DIR/docker-compose.yml"  "$OUT_DIR/docker-compose.yml"
cp "$DOCKER_DIR/entrypoint.sh"       "$OUT_DIR/entrypoint.sh"
cp "$DOCKER_DIR/config.example.yaml" "$OUT_DIR/config.example.yaml"

echo "==> Copying source files..."
cp "$PROJECT_DIR/package.json"       "$OUT_DIR/package.json"
cp "$PROJECT_DIR/package-lock.json"  "$OUT_DIR/package-lock.json"
cp "$PROJECT_DIR/next.config.ts"     "$OUT_DIR/next.config.ts"
cp "$PROJECT_DIR/tsconfig.json"      "$OUT_DIR/tsconfig.json"
cp -r "$PROJECT_DIR/src"             "$OUT_DIR/src"
cp -r "$PROJECT_DIR/public"          "$OUT_DIR/public"

cat > "$OUT_DIR/README.txt" << 'README'
=== kleinanzeigen-bot-ui — Deployment ===

1. Start (builds the image automatically):
     docker compose up --build -d

2. Open http://<your-ip>:3737/setup

3. Complete the Setup Wizard:
     - Kleinanzeigen email + password
     - Contact details (name, zip, city) — optional
     - OpenRouter API key (optional, for AI ad generation)

   The wizard creates config.yaml and user accounts automatically.

4. Manage your ads via the web interface.

See config.example.yaml for all available configuration options.
README

echo ""
echo "==> Export ready ($(du -sh "$OUT_DIR" | cut -f1))"
echo ""
echo "Deploy to your server:"
echo "  rsync -av docker/export/ user@server:/path/to/kleinanzeigen-bot-ui/"
echo "  # on server: docker compose up --build -d"
