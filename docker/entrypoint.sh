#!/bin/sh
# Ensure workspace directories exist
mkdir -p /workspace/.temp /workspace/bot 2>/dev/null || true

# Seed bot binary from image default if not present (first start or volume reset)
if [ ! -f /workspace/bot/kleinanzeigen-bot ]; then
  cp /opt/bot-default/kleinanzeigen-bot /workspace/bot/kleinanzeigen-bot
  chmod +x /workspace/bot/kleinanzeigen-bot
fi

# Fix ownership so botuser can read/write workspace files
chown -R botuser:botuser /workspace 2>/dev/null || true

# Remove stale files that block browser startup after crashes,
# but preserve cookies/session to avoid triggering MFA on every run
find /workspace -path '*/browser-profile/SingletonLock' -delete 2>/dev/null || true
find /workspace -path '*/browser-profile/SingletonCookie' -delete 2>/dev/null || true
find /workspace -path '*/browser-profile/SingletonSocket' -delete 2>/dev/null || true
find /workspace -path '*/browser-profile/DevToolsActivePort' -delete 2>/dev/null || true
find /workspace -path '*/browser-profile/CrashpadMetrics-active.pma' -delete 2>/dev/null || true
# Remove cache dirs that corrupt easily and regenerate automatically
find /workspace -type d -path '*/browser-profile/Default/GPUCache' -exec rm -rf {} + 2>/dev/null || true
find /workspace -type d -path '*/browser-profile/Default/Cache' -exec rm -rf {} + 2>/dev/null || true
find /workspace -type d -path '*/browser-profile/Default/Code Cache' -exec rm -rf {} + 2>/dev/null || true
find /workspace -type d -path '*/browser-profile/Default/DawnCache' -exec rm -rf {} + 2>/dev/null || true

# Drop privileges to botuser and exec the CMD
exec gosu botuser "$@"
