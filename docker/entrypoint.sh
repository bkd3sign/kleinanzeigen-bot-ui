#!/bin/sh
# Ensure workspace directories exist
mkdir -p /workspace/.temp /workspace/bot /workspace/users 2>/dev/null || true

# Seed bot binary from image default if not present (first start or volume reset)
if [ ! -f /workspace/bot/kleinanzeigen-bot ]; then
  cp /opt/bot-default/kleinanzeigen-bot /workspace/bot/kleinanzeigen-bot
  chmod +x /workspace/bot/kleinanzeigen-bot
fi

# Fix ownership so botuser can read/write workspace files.
# Log a warning if chown fails (e.g. user namespace remapping, NAS restrictions).
if ! chown -R botuser:botuser /workspace 2>/dev/null; then
  echo "WARNING: Could not chown /workspace to botuser." >&2
  echo "  Falling back to chmod 777. To fix, ensure the host directory" >&2
  echo "  is owned by UID $(id -u botuser):GID $(id -g botuser)," >&2
  echo "  or rebuild with --build-arg PUID=\$(id -u) PGID=\$(id -g)." >&2
  chmod -R 777 /workspace 2>/dev/null || true
fi

# Remove stale files that block browser startup after crashes,
# but preserve cookies/session to avoid triggering MFA on every run.
# Covers both bot (browser-profile) and messaging (messaging-profile) directories.
for PROFILE in browser-profile messaging-profile; do
  find /workspace -path "*/${PROFILE}/SingletonLock" -delete 2>/dev/null || true
  find /workspace -path "*/${PROFILE}/SingletonCookie" -delete 2>/dev/null || true
  find /workspace -path "*/${PROFILE}/SingletonSocket" -delete 2>/dev/null || true
  find /workspace -path "*/${PROFILE}/DevToolsActivePort" -delete 2>/dev/null || true
  find /workspace -path "*/${PROFILE}/CrashpadMetrics-active.pma" -delete 2>/dev/null || true
  find /workspace -type d -path "*/${PROFILE}/Default/GPUCache" -exec rm -rf {} + 2>/dev/null || true
  find /workspace -type d -path "*/${PROFILE}/Default/Cache" -exec rm -rf {} + 2>/dev/null || true
  find /workspace -type d -path "*/${PROFILE}/Default/Code Cache" -exec rm -rf {} + 2>/dev/null || true
  find /workspace -type d -path "*/${PROFILE}/Default/DawnCache" -exec rm -rf {} + 2>/dev/null || true
done

# Drop privileges to botuser and exec the CMD
exec gosu botuser "$@"
