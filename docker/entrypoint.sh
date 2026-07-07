#!/bin/bash
set -euo pipefail
WORKSPACE="${BOT_DIR:-/workspace}"

# Ensure workspace directories exist
mkdir -p "${WORKSPACE}/.temp" "${WORKSPACE}/bot" "${WORKSPACE}/users" 2>/dev/null || true

# Seed bot binary from image default if not present (first start or volume reset)
if [ ! -f "${WORKSPACE}/bot/kleinanzeigen-bot" ]; then
  cp /opt/bot-default/kleinanzeigen-bot "${WORKSPACE}/bot/kleinanzeigen-bot"
  chmod +x "${WORKSPACE}/bot/kleinanzeigen-bot"
fi

# Fix ownership so botuser can read/write workspace files.
# Log a warning if chown fails (e.g. user namespace remapping, NAS restrictions).
if ! chown -R botuser:botuser "${WORKSPACE}" 2>/dev/null; then
  echo "WARNING: Could not chown ${WORKSPACE} to botuser." >&2
  echo "  Falling back to chmod 777. To fix, ensure the host directory" >&2
  echo "  is owned by UID $(id -u botuser):GID $(id -g botuser)," >&2
  echo "  or rebuild with --build-arg PUID=\$(id -u) PGID=\$(id -g)." >&2
  chmod -R 777 "${WORKSPACE}" 2>/dev/null || true
fi

# Remove stale files that block browser startup after crashes,
# but preserve cookies/session to avoid triggering MFA on every run.
# Covers both bot (browser-profile) and messaging (messaging-profile) directories.
# NOTE: keep this file list in sync with LOCK_FILES + STALE_CACHE_DIRS in
# src/lib/bot/browser-cleanup.ts (the runtime cleanup) — two sources of truth by necessity
# (shell boot sweep vs TS), so a Chromium lock/cache rename must be applied in both.
for PROFILE in browser-profile messaging-profile; do
  find "${WORKSPACE}" -path "*/${PROFILE}/SingletonLock" -delete 2>/dev/null || true
  find "${WORKSPACE}" -path "*/${PROFILE}/SingletonCookie" -delete 2>/dev/null || true
  find "${WORKSPACE}" -path "*/${PROFILE}/SingletonSocket" -delete 2>/dev/null || true
  find "${WORKSPACE}" -path "*/${PROFILE}/DevToolsActivePort" -delete 2>/dev/null || true
  find "${WORKSPACE}" -path "*/${PROFILE}/CrashpadMetrics-active.pma" -delete 2>/dev/null || true
  # Session-restore files: if the previous container was hard-killed mid-run, these send the
  # next Chromium into headless-unsafe restore mode → "ConnectionRefusedError" on the FIRST
  # bot run after an update. They carry no login state (cookies live in the cookie store), so
  # deleting them on every boot is safe and removes that degraded-first-run window.
  find "${WORKSPACE}" -path "*/${PROFILE}/Default/Current Session" -delete 2>/dev/null || true
  find "${WORKSPACE}" -path "*/${PROFILE}/Default/Current Tabs" -delete 2>/dev/null || true
  find "${WORKSPACE}" -path "*/${PROFILE}/Default/Last Session" -delete 2>/dev/null || true
  find "${WORKSPACE}" -path "*/${PROFILE}/Default/Last Tabs" -delete 2>/dev/null || true
  find "${WORKSPACE}" -type d -path "*/${PROFILE}/Default/GPUCache" -exec rm -rf {} + 2>/dev/null || true
  find "${WORKSPACE}" -type d -path "*/${PROFILE}/Default/Cache" -exec rm -rf {} + 2>/dev/null || true
  find "${WORKSPACE}" -type d -path "*/${PROFILE}/Default/Code Cache" -exec rm -rf {} + 2>/dev/null || true
  find "${WORKSPACE}" -type d -path "*/${PROFILE}/Default/DawnCache" -exec rm -rf {} + 2>/dev/null || true
done

# websockify token dir (multi-user VNC routing via TokenFile)
mkdir -p "${WORKSPACE}/.temp/vnc-tokens"
# Remove stale token files from any previous run — no live VNC sessions exist yet on a fresh start.
rm -f "${WORKSPACE}"/.temp/vnc-tokens/* 2>/dev/null || true
chown botuser:botuser "${WORKSPACE}/.temp/vnc-tokens" 2>/dev/null || true

# Shared websockify: serves noVNC statics + routes ?token=<ws> to that workspace's Xvnc.
# Per-workspace Xvnc/Chromium instances are spawned on demand by the app (vnc/lifecycle.ts).
# python3 -m websockify is the reliable invocation for the python3-websockify apt package.
# Bind loopback-only (nginx fronts it via 127.0.0.1) — matches install.sh's systemd unit and
# keeps 6080 off every container interface.
gosu botuser python3 -m websockify --web=/usr/share/novnc --token-plugin TokenFile --token-source "${WORKSPACE}/.temp/vnc-tokens" 127.0.0.1:6080 &
WEBSOCKIFY_PID=$!

# Next.js app on internal port 3001 (nginx fronts port 3000).
gosu botuser env PORT=3001 HOSTNAME=127.0.0.1 "$@" &
APP_PID=$!

# nginx (same-origin entrypoint). Backgrounded so this script stays PID 1 and can
# forward SIGTERM to every service on shutdown — see term_handler below.
nginx -c /etc/nginx/nginx.conf -g 'daemon off;' &
NGINX_PID=$!

# Graceful shutdown: on `docker stop` (SIGTERM) Docker signals only PID 1. Forward
# TERM to the app FIRST so Node can tear down its spawned Xvnc/Chromium children and
# leave no stale SingletonLock/DevToolsActivePort behind (which would otherwise cause
# "Failed to connect to browser" on the next start), then stop nginx + websockify.
term_handler() {
  kill -TERM "$APP_PID" 2>/dev/null || true
  wait "$APP_PID" 2>/dev/null || true
  kill -TERM "$NGINX_PID" "$WEBSOCKIFY_PID" 2>/dev/null || true
  exit 0
}
trap term_handler TERM INT

# Keep the container alive until any service exits (or a signal arrives), then shut
# the rest down cleanly instead of letting Docker SIGKILL them after the grace period.
wait -n "$APP_PID" "$NGINX_PID" "$WEBSOCKIFY_PID" || true
term_handler
