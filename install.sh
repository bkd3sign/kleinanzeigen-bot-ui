#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Kleinanzeigen-Bot UI — Installer
# Supports: Debian Trixie (13)+, Ubuntu 24.04+, Arch Linux
# Architectures: amd64, arm64 (Raspberry Pi 3B+/4/5, other arm64 SBCs)
# No Docker required. Works in LXC (Proxmox), VMs, and bare metal.
#
# Usage:
#   bash install.sh              — interactive guided setup
#   bash install.sh --yes        — non-interactive, use all defaults
#   bash install.sh --update     — update existing install (no system deps, ~3 min)
#
# Env overrides (skip prompts):
#   INSTALL_DIR, WORKSPACE_DIR, PORT, SERVICE_USER, BOT_RELEASE
# ─────────────────────────────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'
CYAN='\033[0;36m'

info()    { echo -e "${BLUE}▸${RESET} $*"; }
success() { echo -e "${GREEN}✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET} $*"; }
error()   { echo -e "${RED}✗ $*${RESET}"; exit 1; }
step()    { echo -e "\n${CYAN}${BOLD}[$1/$TOTAL_STEPS] $2${RESET}"; }

REPO_URL="https://github.com/bkd3sign/kleinanzeigen-bot-ui"

UPDATE_MODE=false
NON_INTERACTIVE=false
for arg in "$@"; do
  [[ "$arg" == "--yes" ]] && NON_INTERACTIVE=true
  [[ "$arg" == "--update" ]] && UPDATE_MODE=true
done
[[ ! -t 0 ]] && NON_INTERACTIVE=true

ask() {
  local prompt="$1" default="$2" varname="$3"
  if [[ "$NON_INTERACTIVE" == "true" ]]; then
    printf -v "$varname" '%s' "$default"
  else
    read -r -p "  $prompt [${default}]: " input
    printf -v "$varname" '%s' "${input:-$default}"
  fi
}

TOTAL_STEPS=8

# ─── Root check ──────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Run as root: sudo bash install.sh"

echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║   Kleinanzeigen-Bot UI — Installer               ║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════╝${RESET}"
echo ""

# ─── Update mode (--update): skip system deps, just pull + build + restart ───
if [[ "$UPDATE_MODE" == "true" ]]; then
  TOTAL_STEPS=3
  INSTALL_DIR="${INSTALL_DIR:-/opt/kleinanzeigen-bot-ui}"
  [[ ! -d "$INSTALL_DIR/.git" ]] && error "No installation found at $INSTALL_DIR — run without --update first"
  NODE_BIN=$(command -v node 2>/dev/null) || error "Node.js not found — run full installer first"

  TOTAL_MEM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
  if [[ "$TOTAL_MEM_MB" -lt 2048 ]]; then
    export NODE_OPTIONS="--max-old-space-size=$((TOTAL_MEM_MB / 2))"
    info "NODE_OPTIONS set to --max-old-space-size=$((TOTAL_MEM_MB / 2))"
  fi

  AVAIL_DISK_MB=$(df -m / | awk 'NR==2 {print $4}')
  if [[ "$AVAIL_DISK_MB" -lt 1024 ]]; then
    warn "Low disk: ${AVAIL_DISK_MB}MB available — rebuild needs ~1GB free."
  fi

  step 1 "Pulling latest changes"
  git -C "$INSTALL_DIR" pull --ff-only
  success "Repository updated"

  step 2 "Rebuilding application"
  cd "$INSTALL_DIR"
  info "Installing npm dependencies..."
  npm ci --prefer-offline 2>&1 | tail -3
  info "Building Next.js app..."
  npm run build 2>&1 | tail -5
  STANDALONE_DIR="$INSTALL_DIR/.next/standalone"
  info "Copying static assets..."
  cp -r public "$STANDALONE_DIR/public"
  cp -r .next/static "$STANDALONE_DIR/.next/static"
  mkdir -p "$STANDALONE_DIR/node_modules"
  cp -r node_modules/ws "$STANDALONE_DIR/node_modules/ws"
  success "Build complete"

  step 3 "Restarting service"
  systemctl restart kleinanzeigen-bot-ui
  STARTED=false
  for i in {1..10}; do
    sleep 2
    if systemctl is-active --quiet kleinanzeigen-bot-ui; then
      STARTED=true; break
    fi
  done
  if [[ "$STARTED" == "true" ]]; then
    success "Service restarted"
  else
    warn "Service may not have started — check: journalctl -u kleinanzeigen-bot-ui -n 50"
  fi

  IP=$(hostname -I | awk '{print $1}')
  PORT=$(systemctl show kleinanzeigen-bot-ui -p Environment --value 2>/dev/null | grep -oP 'PORT=\K\d+' || echo "3737")
  echo ""
  echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════╗${RESET}"
  echo -e "${GREEN}${BOLD}║   Update complete!                               ║${RESET}"
  echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════╝${RESET}"
  echo ""
  echo -e "  ${BOLD}Web UI:${RESET}  http://${IP}:${PORT}"
  echo ""
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
step 1 "Detecting system & container environment"
# ─────────────────────────────────────────────────────────────────────────────

# Detect LXC
IS_LXC=false
if command -v systemd-detect-virt &>/dev/null && systemd-detect-virt --container 2>/dev/null | grep -q "lxc"; then
  IS_LXC=true
elif grep -q "container=lxc" /proc/1/environ 2>/dev/null; then
  IS_LXC=true
fi

# Detect OS
[[ ! -f /etc/os-release ]] && error "Cannot detect OS (/etc/os-release not found)"
source /etc/os-release
OS_ID="${ID:-unknown}"
OS_VERSION_ID="${VERSION_ID:-}"
OS_ID_LIKE="${ID_LIKE:-}"

if [[ "$OS_ID" == "arch" ]] || echo "$OS_ID_LIKE" | grep -q "arch"; then
  PKG_MANAGER="pacman"
elif [[ "$OS_ID" == "debian" ]] || [[ "$OS_ID" == "ubuntu" ]] || echo "$OS_ID_LIKE" | grep -q "debian"; then
  PKG_MANAGER="apt"
else
  error "Unsupported OS: $OS_ID. Supported: Debian 13+, Ubuntu 24.04+, Arch Linux"
fi

# Detect architecture
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  BOT_ARCH="amd64" ;;
  aarch64) BOT_ARCH="arm64" ;;
  armv7l|armv6l)
    echo ""
    echo -e "${RED}${BOLD}  ✗ 32-bit ARM ($ARCH) is not supported${RESET}"
    echo ""
    echo -e "  The kleinanzeigen-bot binary is only available for 64-bit systems."
    echo ""
    echo -e "  ${YELLOW}Raspberry Pi tip:${RESET} Switch to a 64-bit OS (Raspberry Pi OS 64-bit or Ubuntu 24.04 Server for Pi)."
    echo ""
    echo -e "  Supported hardware: Raspberry Pi 3B+, 4, 5 (with 64-bit OS)"
    echo ""
    exit 1
    ;;
  *) error "Unsupported architecture: $ARCH (supported: x86_64, aarch64)" ;;
esac

# glibc check — bot binary requires >= 2.38 (built on Ubuntu 24.04)
if [[ "$PKG_MANAGER" == "apt" ]]; then
  GLIBC_VERSION=$(ldd --version 2>/dev/null | head -1 | grep -oP '\d+\.\d+$' || echo "0.0")
  GLIBC_MINOR=$(echo "$GLIBC_VERSION" | cut -d. -f2)
  if [[ "${GLIBC_MINOR}" -lt 38 ]]; then
    echo ""
    echo -e "${RED}${BOLD}  ✗ glibc ${GLIBC_VERSION} is too old — need >= 2.38${RESET}"
    echo ""
    echo -e "  ${GREEN}Supported:${RESET}"
    echo -e "    ✓  Debian 13 (Trixie)        — glibc 2.40"
    echo -e "    ✓  Ubuntu 24.04 LTS          — glibc 2.39"
    echo -e "    ✓  Arch Linux                — rolling (always current)"
    echo ""
    echo -e "  ${RED}Not supported:${RESET}"
    echo -e "    ✗  Debian 12 (Bookworm)      — glibc 2.36  ← default Proxmox template"
    echo -e "    ✗  Raspberry Pi OS (Bookworm) — glibc 2.36  ← default RPi OS"
    echo -e "    ✗  Ubuntu 22.04 LTS          — glibc 2.35"
    echo ""
    if [[ "$IS_LXC" == "true" ]]; then
      echo -e "  ${YELLOW}Proxmox:${RESET} Download 'debian-13-standard' or 'ubuntu-24.04-standard'"
      echo -e "  in the Proxmox web UI under Datacenter → Storage → CT Templates."
    elif [[ "$ARCH" == "aarch64" ]]; then
      echo -e "  ${YELLOW}Raspberry Pi:${RESET} Download Ubuntu 24.04 Server for Raspberry Pi:"
      echo -e "  https://ubuntu.com/download/raspberry-pi"
    fi
    echo ""
    exit 1
  fi
fi

# LXC AppArmor check
if [[ "$IS_LXC" == "true" ]]; then
  APPARMOR_STATUS=$(cat /proc/self/attr/current 2>/dev/null | tr -d '\0' || echo "unconfined")
  if [[ "$APPARMOR_STATUS" != "unconfined" ]]; then
    echo ""
    echo -e "${YELLOW}${BOLD}  ⚠ AppArmor is active in this LXC container!${RESET}"
    echo -e "  Chromium will fail to start with AppArmor confinement."
    echo ""
    echo -e "  Fix on the Proxmox host — add to your container config:"
    echo ""
    echo -e "    ${BOLD}/etc/pve/lxc/<ID>.conf:${RESET}"
    echo -e "    ${BOLD}  lxc.apparmor.profile: unconfined${RESET}"
    echo ""
    echo -e "  Then restart the container and re-run this script."
    echo ""
    if [[ "$NON_INTERACTIVE" == "false" ]]; then
      read -r -p "  Continue anyway? [y/N] " CONTINUE
      [[ "${CONTINUE,,}" != "y" ]] && exit 0
    fi
  else
    success "AppArmor: unconfined (OK for Chromium)"
  fi
fi

# Memory check — warn on systems with < 2GB RAM (affects build)
TOTAL_MEM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
if [[ "$TOTAL_MEM_MB" -lt 2048 ]]; then
  warn "Low memory: ${TOTAL_MEM_MB}MB RAM detected. Next.js build needs ~1.5GB free — add swap to be safe:"
  warn "Consider adding swap before continuing:"
  warn "  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile"
  # Cap Node.js heap to half of total RAM to avoid OOM kill
  export NODE_OPTIONS="--max-old-space-size=$((TOTAL_MEM_MB / 2))"
  info "NODE_OPTIONS set to --max-old-space-size=$((TOTAL_MEM_MB / 2)) for build"
fi

# Disk space check — install needs ~2GB (node_modules + Next.js build output + bot binary)
AVAIL_DISK_MB=$(df -m / | awk 'NR==2 {print $4}')
if [[ "$AVAIL_DISK_MB" -lt 2048 ]]; then
  warn "Low disk: ${AVAIL_DISK_MB}MB available on / — install needs ~2GB free."
  warn "Expand the container before proceeding:"
  warn "  Proxmox: Container → Resources → Root Disk → Resize"
  if [[ "$NON_INTERACTIVE" == "false" ]]; then
    read -r -p "  Continue anyway? [y/N] " DISK_CONTINUE
    [[ "${DISK_CONTINUE,,}" != "y" ]] && exit 0
  fi
fi

VIRT_TYPE=$(systemd-detect-virt 2>/dev/null || echo "bare metal")
success "OS: ${OS_ID} ${OS_VERSION_ID} | Arch: ${ARCH} | RAM: ${TOTAL_MEM_MB}MB | Env: ${VIRT_TYPE}"

# ─────────────────────────────────────────────────────────────────────────────
step 2 "Configuration"
# ─────────────────────────────────────────────────────────────────────────────

if [[ "$NON_INTERACTIVE" == "false" ]]; then
  echo ""
  echo -e "  Answer the following questions to configure your installation."
  echo -e "  Press ${BOLD}Enter${RESET} to accept the default shown in [brackets]."
  echo ""
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_DIR="${INSTALL_DIR:-/opt/kleinanzeigen-bot-ui}"
if [[ -f "$SCRIPT_DIR/package.json" ]] && grep -q "kleinanzeigen-bot-ui" "$SCRIPT_DIR/package.json" 2>/dev/null; then
  DEFAULT_INSTALL_DIR="$SCRIPT_DIR"
fi

ask "Install directory (app source + build)" "$DEFAULT_INSTALL_DIR" INSTALL_DIR

if [[ "$INSTALL_DIR" == "$SCRIPT_DIR" || "$INSTALL_DIR" == "$SCRIPT_DIR/"* ]]; then
  echo ""
  echo -e "${RED}✗ Cannot install into the directory where install.sh is running from.${RESET}"
  echo -e "  The installer would delete itself during setup."
  echo -e "  Run from /tmp instead:"
  echo ""
  echo -e "    ${BOLD}curl -fsSL $REPO_URL/raw/main/install.sh -o /tmp/install.sh && sudo bash /tmp/install.sh${RESET}"
  echo ""
  exit 1
fi

ask "Workspace directory (config, ads, bot binary)" "${WORKSPACE_DIR:-/opt/workspace}" WORKSPACE_DIR

if [[ "$WORKSPACE_DIR" == "$INSTALL_DIR" || "$WORKSPACE_DIR" == "$INSTALL_DIR/"* ]]; then
  echo ""
  echo -e "${RED}✗ Workspace cannot be inside the install directory.${RESET}"
  echo -e "  The install directory may be wiped during setup or updates."
  echo -e "  Choose a path outside of ${BOLD}$INSTALL_DIR${RESET} — e.g. /opt/workspace"
  echo ""
  exit 1
fi
ask "Web interface port" "${PORT:-3737}" PORT
[[ "$PORT" =~ ^[0-9]+$ ]] || error "Invalid port: $PORT"

echo ""
if [[ "$NON_INTERACTIVE" == "false" ]]; then
  echo -e "  Service user:"
  echo -e "    ${BOLD}botuser${RESET} — dedicated non-root user ${GREEN}(recommended)${RESET}"
  echo -e "    ${BOLD}root${RESET}    — ${YELLOW}not recommended: Chromium/nodriver refuses to start as root${RESET}"
  echo ""
fi
ask "Service user (botuser or root or custom)" "${SERVICE_USER:-botuser}" SERVICE_USER

if [[ "$SERVICE_USER" == "root" ]]; then
  echo ""
  warn "Running as root is known to break Chromium (nodriver refuses to start as root)."
  warn "Use 'botuser' unless you have a specific reason to run as root."
  echo ""
  if [[ "$NON_INTERACTIVE" == "false" ]]; then
    read -r -p "  Continue with root anyway? [y/N] " ROOT_CONFIRM
    [[ "${ROOT_CONFIRM,,}" != "y" ]] && exit 0
  fi
fi

echo ""
if [[ "$NON_INTERACTIVE" == "false" ]]; then
  echo -e "  Bot binary release:"
  echo -e "    ${BOLD}latest${RESET}       — current stable release"
  echo -e "    ${BOLD}2026+7560dd4${RESET} — specific release tag (example)"
  echo ""
fi
ask "Release tag" "${BOT_RELEASE:-latest}" BOT_RELEASE

echo ""
echo -e "${BOLD}  Installation summary:${RESET}"
echo -e "    Install dir:  $INSTALL_DIR"
echo -e "    Workspace:    $WORKSPACE_DIR"
echo -e "    Port:         $PORT"
echo -e "    Service user: $SERVICE_USER"
echo -e "    Bot release:  $BOT_RELEASE"
echo ""

if [[ "$NON_INTERACTIVE" == "false" ]]; then
  read -r -p "  Proceed? [Y/n] " CONFIRM
  [[ "${CONFIRM,,}" == "n" ]] && exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
step 3 "Installing system dependencies"
# ─────────────────────────────────────────────────────────────────────────────

if [[ "$PKG_MANAGER" == "apt" ]]; then
  apt-get update -qq
  apt-get install -y --no-install-recommends \
    curl git ca-certificates gnupg python3 python3-yaml procps

  NODE_MAJOR=$(node --version 2>/dev/null | grep -oP '\d+' | head -1 || echo "0")
  if [[ "$NODE_MAJOR" -lt 22 ]]; then
    info "Installing Node.js 22 via NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
    apt-get install -y nodejs
  fi

  # Ubuntu ships chromium as a snap transitional package which cannot run inside
  # a headless systemd service (requires user session / cgroup context).
  # Add xtradeb/apps directly via GPG key + sources file — no software-properties-common needed.
  # Debian always ships a real .deb — no PPA needed.
  if [[ "$OS_ID" == "ubuntu" ]]; then
    info "Ubuntu: adding xtradeb/apps repo for real Chromium .deb (avoids snap)..."
    UBUNTU_CODENAME=$(. /etc/os-release && echo "${VERSION_CODENAME}")
    curl -fsSL "https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x5301FA4FD93244FBC6F6149982BB6851C64F6880" \
      | gpg --dearmor -o /usr/share/keyrings/xtradeb-apps.gpg
    printf 'deb [arch=%s signed-by=/usr/share/keyrings/xtradeb-apps.gpg] http://ppa.launchpad.net/xtradeb/apps/ubuntu %s main\n' \
      "$(dpkg --print-architecture)" "$UBUNTU_CODENAME" \
      > /etc/apt/sources.list.d/xtradeb-apps.list
    apt-get update -qq
  fi

  apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji

  # Safety net: snap only exists on Ubuntu — replace if it snuck in despite the PPA
  if [[ "$OS_ID" == "ubuntu" ]] && snap list 2>/dev/null | grep -q "^chromium"; then
    warn "Snap Chromium still present — removing and reinstalling from xtradeb/apps..."
    snap remove chromium 2>/dev/null || true
    if ! grep -rq "xtradeb" /etc/apt/sources.list.d/ 2>/dev/null; then
      UBUNTU_CODENAME=$(. /etc/os-release && echo "${VERSION_CODENAME}")
      curl -fsSL "https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x5301FA4FD93244FBC6F6149982BB6851C64F6880" \
        | gpg --dearmor -o /usr/share/keyrings/xtradeb-apps.gpg
      printf 'deb [arch=%s signed-by=/usr/share/keyrings/xtradeb-apps.gpg] http://ppa.launchpad.net/xtradeb/apps/ubuntu %s main\n' \
        "$(dpkg --print-architecture)" "$UBUNTU_CODENAME" \
        > /etc/apt/sources.list.d/xtradeb-apps.list
    fi
    apt-get update -qq
    apt-get install -y --no-install-recommends chromium
    success "Chromium .deb installed"
  fi

elif [[ "$PKG_MANAGER" == "pacman" ]]; then
  pacman -Sy --noconfirm --needed curl git nodejs npm chromium python python-yaml procps-ng
fi

NODE_BIN=$(command -v node) || error "node binary not found after installation"
success "Node.js $(node --version) at $NODE_BIN"

# Detect Chromium binary — prefer non-snap over snap
CHROMIUM_BIN=""
for bin in /usr/bin/chromium /usr/bin/chromium-browser chromium chromium-browser; do
  if command -v "$bin" &>/dev/null; then
    CHROMIUM_BIN="$(command -v "$bin")"
    break
  fi
done
[[ -z "$CHROMIUM_BIN" ]] && error "Chromium not found after installation"
success "Chromium: $CHROMIUM_BIN"

# Chromium headless smoke test
info "Testing Chromium headless launch..."
CHROMIUM_TEST=$(timeout 20 "$CHROMIUM_BIN" \
  --headless --no-sandbox --disable-dev-shm-usage --disable-gpu --password-store=basic \
  --dump-dom about:blank 2>&1 || true)

if echo "$CHROMIUM_TEST" | grep -q "<html"; then
  success "Chromium headless test passed"
elif echo "$CHROMIUM_TEST" | grep -qi "apparmor\|permission denied\|operation not permitted"; then
  echo ""
  echo -e "${RED}${BOLD}  ✗ Chromium blocked — AppArmor or permission issue${RESET}"
  echo ""
  echo "$CHROMIUM_TEST" | grep -i "error\|denied\|apparmor" | head -3 | sed 's/^/  /'
  echo ""
  echo -e "  Fix on the Proxmox host:"
  echo -e "  ${BOLD}    /etc/pve/lxc/<ID>.conf  →  lxc.apparmor.profile: unconfined${RESET}"
  echo -e "  Then restart the container and re-run this script."
  echo ""
  exit 1
else
  warn "Chromium smoke test inconclusive — continuing (first bot run will confirm)"
fi

# ─────────────────────────────────────────────────────────────────────────────
step 4 "Setting up service user and directories"
# ─────────────────────────────────────────────────────────────────────────────

if [[ "$SERVICE_USER" != "root" ]]; then
  if ! id "$SERVICE_USER" &>/dev/null; then
    info "Creating user: $SERVICE_USER"
    useradd -r -m -s /bin/bash "$SERVICE_USER"
    success "User created: $SERVICE_USER"
  else
    success "User exists: $SERVICE_USER"
  fi
fi

mkdir -p \
  "$WORKSPACE_DIR/bot" \
  "$WORKSPACE_DIR/ads" \
  "$WORKSPACE_DIR/users" \
  "$WORKSPACE_DIR/.temp"

success "Workspace directories created at $WORKSPACE_DIR"

# ─────────────────────────────────────────────────────────────────────────────
step 5 "Building application"
# ─────────────────────────────────────────────────────────────────────────────

if [[ -f "$INSTALL_DIR/package.json" ]] && grep -q "kleinanzeigen-bot-ui" "$INSTALL_DIR/package.json" 2>/dev/null; then
  info "Using source at $INSTALL_DIR"
elif [[ -d "$INSTALL_DIR/.git" ]]; then
  info "Updating existing installation at $INSTALL_DIR..."
  git -C "$INSTALL_DIR" pull --ff-only
else
  if [[ -d "$INSTALL_DIR" ]]; then
    echo ""
    warn "$INSTALL_DIR exists but is not a valid installation (no .git, no package.json)."
    warn "It will be deleted and re-cloned from GitHub."
    warn "Your workspace data (config, ads) in $WORKSPACE_DIR is NOT affected."
    warn "Make sure you have a backup of any custom files in $INSTALL_DIR before continuing!"
    echo ""
    if [[ "$NON_INTERACTIVE" == "false" ]]; then
      read -r -p "  Delete $INSTALL_DIR and continue? [y/N] " DEL_CONFIRM
      [[ "${DEL_CONFIRM,,}" != "y" ]] && exit 0
    fi
    info "Removing incomplete installation at $INSTALL_DIR..."
    rm -rf "$INSTALL_DIR"
  fi
  info "Cloning repository to $INSTALL_DIR..."
  git clone --depth=1 "$REPO_URL" "$INSTALL_DIR"
  success "Repository cloned"
fi

cd "$INSTALL_DIR"

if [[ "$TOTAL_MEM_MB" -lt 2048 ]]; then
  info "Build may take 10–20 minutes on this hardware — please be patient..."
fi

info "Installing npm dependencies..."
npm ci --prefer-offline 2>&1 | tail -3
info "Building Next.js app..."
npm run build 2>&1 | tail -5

STANDALONE_DIR="$INSTALL_DIR/.next/standalone"

# Next.js standalone does not copy these automatically
info "Copying static assets into standalone output..."
cp -r "$INSTALL_DIR/public" "$STANDALONE_DIR/public"
cp -r "$INSTALL_DIR/.next/static" "$STANDALONE_DIR/.next/static"
# ws is in serverExternalPackages — not bundled, must be present at runtime
mkdir -p "$STANDALONE_DIR/node_modules"
cp -r "$INSTALL_DIR/node_modules/ws" "$STANDALONE_DIR/node_modules/ws"

success "Build complete"

# ─────────────────────────────────────────────────────────────────────────────
step 6 "Downloading kleinanzeigen-bot binary"
# ─────────────────────────────────────────────────────────────────────────────

BOT_BIN="$WORKSPACE_DIR/bot/kleinanzeigen-bot"

# GitHub uses a different URL pattern for "latest" vs tagged releases
if [[ "$BOT_RELEASE" == "latest" ]]; then
  BOT_URL="https://github.com/Second-Hand-Friends/kleinanzeigen-bot/releases/latest/download/kleinanzeigen-bot-linux-${BOT_ARCH}"
else
  BOT_URL="https://github.com/Second-Hand-Friends/kleinanzeigen-bot/releases/download/${BOT_RELEASE}/kleinanzeigen-bot-linux-${BOT_ARCH}"
fi

info "Downloading from $BOT_URL..."
curl -fSL "$BOT_URL" -o "$BOT_BIN"
chmod +x "$BOT_BIN"

BOT_VERSION=$("$BOT_BIN" version 2>&1 | head -1 || echo "unknown")
success "Bot binary: $BOT_VERSION"

# ─────────────────────────────────────────────────────────────────────────────
step 7 "Creating configuration"
# ─────────────────────────────────────────────────────────────────────────────

CONFIG_FILE="$WORKSPACE_DIR/config.yaml"
if [[ ! -f "$CONFIG_FILE" ]]; then
  info "Creating config.yaml from template..."
  cp "$INSTALL_DIR/docker/config.example.yaml" "$CONFIG_FILE"
fi

# Always write the correct browser settings (binary path can change between installs)
info "Configuring browser settings in config.yaml..."
_CB="$CHROMIUM_BIN" _CF="$CONFIG_FILE" python3 - <<'PYEOF'
import yaml, os
f  = os.environ['_CF']
cb = os.environ['_CB']
with open(f) as fh:
    d = yaml.safe_load(fh) or {}
b = d.setdefault('browser', {})
b['binary_location'] = cb
if not b.get('arguments'):
    b['arguments'] = ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--password-store=basic']
b.setdefault('use_private_window', True)
with open(f, 'w') as fh:
    yaml.dump(d, fh, allow_unicode=True, default_flow_style=False)
PYEOF
success "config.yaml: browser.binary_location → $CHROMIUM_BIN"

# ─────────────────────────────────────────────────────────────────────────────
step 8 "Setting permissions and installing systemd service"
# ─────────────────────────────────────────────────────────────────────────────

if [[ "$SERVICE_USER" != "root" ]]; then
  info "Setting ownership for user $SERVICE_USER..."
  chown -R "$SERVICE_USER:$SERVICE_USER" "$WORKSPACE_DIR"
  chown -R "$SERVICE_USER:$SERVICE_USER" "$STANDALONE_DIR"
  chmod 600 "$CONFIG_FILE"
  chown "$SERVICE_USER:$SERVICE_USER" "$CONFIG_FILE"
  success "Ownership set"
else
  chmod 600 "$CONFIG_FILE"
fi

chmod +x "$BOT_BIN"

SERVICE_FILE="/etc/systemd/system/kleinanzeigen-bot-ui.service"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Kleinanzeigen Bot UI
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${STANDALONE_DIR}
Environment=BOT_DIR=${WORKSPACE_DIR}
Environment=BOT_CMD=${BOT_BIN}
Environment=PORT=${PORT}
Environment=HOSTNAME=0.0.0.0
Environment=NODE_ENV=production
Environment=NEXT_TELEMETRY_DISABLED=1
Environment=TZ=${TZ:-Europe/Berlin}
ExecStart=${NODE_BIN} server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable kleinanzeigen-bot-ui
systemctl restart kleinanzeigen-bot-ui

# Wait up to 20s for service to start (slow on RPi)
STARTED=false
for i in {1..10}; do
  sleep 2
  if systemctl is-active --quiet kleinanzeigen-bot-ui; then
    STARTED=true
    break
  fi
done

if [[ "$STARTED" == "true" ]]; then
  success "Service started successfully"
else
  warn "Service may not have started — check: journalctl -u kleinanzeigen-bot-ui -n 50"
fi

# ─── Done ────────────────────────────────────────────────────────────────────
IP=$(hostname -I | awk '{print $1}')

echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║   Installation complete!                         ║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${BOLD}Web UI:${RESET}     http://${IP}:${PORT}"
echo -e "  ${BOLD}Config:${RESET}     ${CONFIG_FILE}"
echo -e "  ${BOLD}Workspace:${RESET}  ${WORKSPACE_DIR}"
echo -e "  ${BOLD}Service:${RESET}    kleinanzeigen-bot-ui (systemd)"
echo ""
echo -e "  ${YELLOW}${BOLD}Next step:${RESET}"
echo -e "  Open the web UI and complete setup:"
echo -e "  ${BOLD}  http://${IP}:${PORT}/setup${RESET}"
echo -e "  The setup wizard will configure your credentials and contact details."
echo ""
echo -e "  ${BOLD}Useful commands:${RESET}"
echo -e "    journalctl -u kleinanzeigen-bot-ui -f   # live logs"
echo -e "    systemctl status kleinanzeigen-bot-ui   # status"
echo -e "    systemctl restart kleinanzeigen-bot-ui  # restart"
echo ""
