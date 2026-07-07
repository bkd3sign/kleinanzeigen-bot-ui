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
#   bash install.sh --update     — update existing install; provisions the VNC stack
#                                  (nginx + websockify + noVNC) on first run, ~5-15 min
#
# Env overrides (skip prompts):
#   INSTALL_DIR, WORKSPACE_DIR, PORT, SERVICE_USER, BOT_RELEASE, COOKIE_SECURE
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
# Bumped whenever the --update/provisioning logic changes. Enables single-command
# self-update: --update re-execs the freshly pulled installer when this rev differs.
INSTALLER_REV=2

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

# ─────────────────────────────────────────────────────────────────────────────
# Shared VNC/nginx provisioning helpers
# Called from BOTH the fresh-install path and the --update path so a single code
# path provisions the Docker-equivalent three-process topology (nginx → app +
# websockify → per-workspace Xvnc). Every function is idempotent and safe to re-run.
# ─────────────────────────────────────────────────────────────────────────────

VNC_SERVICE_NAME="kleinanzeigen-bot-vnc"
NGINX_SITE_FILE="/etc/nginx/conf.d/kleinanzeigen-bot-ui.conf"
NOVNC_DIR="/usr/share/novnc"
NOVNC_VERSION="v1.6.0"
WEBSOCKIFY_PORT="6080"
APP_INTERNAL_PORT_DEFAULT="3001"

# Detect the Chromium binary path (prefers the non-snap /usr/bin locations).
# Sets global CHROMIUM_BIN (empty string if none found).
detect_chromium_bin() {
  CHROMIUM_BIN=""
  local bin
  for bin in /usr/bin/chromium /usr/bin/chromium-browser chromium chromium-browser; do
    if command -v "$bin" &>/dev/null; then
      CHROMIUM_BIN="$(command -v "$bin")"
      break
    fi
  done
}

# Pick a loopback app port that does not collide with the public port.
# Sets global APP_INTERNAL_PORT.
compute_app_internal_port() {
  local public="$1"
  APP_INTERNAL_PORT="$APP_INTERNAL_PORT_DEFAULT"
  if [[ "$public" == "$APP_INTERNAL_PORT" ]]; then
    APP_INTERNAL_PORT="3002"
  fi
}

# Install the VNC/nginx stack, but only the packages that are actually missing,
# so a repeated --update stays fast and never runs apt when nothing is needed.
ensure_vnc_packages() {
  if [[ "$PKG_MANAGER" == "apt" ]]; then
    local missing=()
    command -v Xvnc &>/dev/null                || missing+=("tigervnc-standalone-server")
    python3 -c 'import websockify' &>/dev/null  || missing+=("python3-websockify")
    command -v matchbox-window-manager &>/dev/null || missing+=("matchbox-window-manager")
    command -v nginx &>/dev/null               || missing+=("nginx-light")
    # pgrep (procps) is required by the app's orphan-cleanup (freeXDisplay / killOrphanedChromium).
    # Ensure it here too so a --update on a host that predates procps installs it.
    command -v pgrep &>/dev/null               || missing+=("procps")
    dpkg -s fonts-liberation &>/dev/null       || missing+=("fonts-liberation")
    dpkg -s fonts-noto-color-emoji &>/dev/null || missing+=("fonts-noto-color-emoji")
    if [[ ${#missing[@]} -gt 0 ]]; then
      info "Installing VNC/nginx stack: ${missing[*]}"
      apt-get update -qq
      apt-get install -y --no-install-recommends "${missing[@]}"
    else
      success "VNC/nginx packages already present"
    fi
  elif [[ "$PKG_MANAGER" == "pacman" ]]; then
    local missing=()
    command -v Xvnc &>/dev/null                || missing+=("tigervnc")
    python3 -c 'import websockify' &>/dev/null  || missing+=("python-websockify")
    command -v nginx &>/dev/null               || missing+=("nginx")
    # pgrep (procps-ng) is required by the app's orphan-cleanup (freeXDisplay / killOrphanedChromium).
    command -v pgrep &>/dev/null               || missing+=("procps-ng")
    pacman -Q noto-fonts &>/dev/null           || missing+=("noto-fonts")
    pacman -Q ttf-liberation &>/dev/null       || missing+=("ttf-liberation")
    if [[ ${#missing[@]} -gt 0 ]]; then
      info "Installing VNC/nginx stack: ${missing[*]}"
      pacman -Sy --noconfirm --needed "${missing[@]}"
    fi
    # matchbox-window-manager lives in the AUR on Arch; it is only cosmetic
    # (keeps the kiosk window borderless), so its absence is a warning, not an error.
    command -v matchbox-window-manager &>/dev/null || \
      warn "matchbox-window-manager not in official Arch repos — VNC login works, but the window may show a desktop border. Install it from the AUR for a borderless view."
  fi
}

# Vendor noVNC static files into /usr/share/novnc (mirrors docker/Dockerfile).
# Idempotent: skips the download if vnc.html is already present.
ensure_novnc_static() {
  if [[ -f "$NOVNC_DIR/vnc.html" ]]; then
    success "noVNC already vendored at $NOVNC_DIR"
    return 0
  fi
  info "Vendoring noVNC ${NOVNC_VERSION} into $NOVNC_DIR..."
  local tgz="/tmp/novnc-${NOVNC_VERSION}.tgz"
  # --max-time guards against an indefinite hang on a slow/blocked network; fail
  # loudly with a clear cause instead of stalling the installer for minutes.
  curl -fSL --max-time 60 "https://github.com/novnc/noVNC/archive/refs/tags/${NOVNC_VERSION}.tar.gz" -o "$tgz" \
    || error "noVNC download failed (network/proxy/GitHub unreachable) — could not fetch ${NOVNC_VERSION}. Retry once connectivity is restored: bash install.sh --update"
  mkdir -p "$NOVNC_DIR"
  tar xzf "$tgz" -C "$NOVNC_DIR" --strip-components=1
  rm -f "$tgz"
  [[ -f "$NOVNC_DIR/vnc.html" ]] || error "noVNC vendoring failed — $NOVNC_DIR/vnc.html not found"
  success "noVNC vendored ($NOVNC_VERSION)"
}

# Merge browser settings (binary path + headless args) into config.yaml, preserving
# existing custom args. Used by fresh install and re-applied on --update.
write_browser_config() {
  local config_file="$1" chromium_bin="$2"
  _CB="$chromium_bin" _CF="$config_file" python3 - <<'PYEOF'
import yaml, os
f  = os.environ['_CF']
cb = os.environ['_CB']
with open(f) as fh:
    d = yaml.safe_load(fh) or {}
b = d.setdefault('browser', {})
b['binary_location'] = cb
required_args = ['--headless', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--password-store=basic']
existing_args = b.get('arguments', [])
for arg in required_args:
    if arg not in existing_args:
        existing_args.append(arg)
b['arguments'] = existing_args
b.setdefault('use_private_window', True)
with open(f, 'w') as fh:
    yaml.dump(d, fh, allow_unicode=True, default_flow_style=False)
PYEOF
}

# Detect LXC. Sets global IS_LXC. Shared by fresh-install checks and --update preflight.
detect_lxc() {
  IS_LXC=false
  if command -v systemd-detect-virt &>/dev/null && systemd-detect-virt --container 2>/dev/null | grep -q "lxc"; then
    IS_LXC=true
  elif grep -q "container=lxc" /proc/1/environ 2>/dev/null; then
    IS_LXC=true
  fi
}

# Headless Chromium smoke test as the service user; echoes the DOM/error output.
# Single source of the Chromium flags; callers decide if a missing "<html" is fatal.
run_chromium_smoke() {
  local svc_user="$1" chromium_bin="$2"
  if [[ "$svc_user" == "root" ]]; then
    timeout 20 "$chromium_bin" \
      --headless --no-sandbox --disable-dev-shm-usage --disable-gpu --password-store=basic \
      --dump-dom about:blank 2>&1 || true
  else
    local svc_home
    svc_home=$(getent passwd "$svc_user" | cut -d: -f6)
    su -s /bin/bash "$svc_user" -c "
      export HOME='$svc_home'
      timeout 20 '$chromium_bin' --headless --no-sandbox \
        --disable-dev-shm-usage --disable-gpu --password-store=basic \
        --dump-dom about:blank
    " 2>&1 || true
  fi
}

# --update preflight: warn (never abort) if this host/LXC cannot run Chromium.
vnc_preflight_check() {
  local svc_user="$1" chromium_bin="$2"
  detect_lxc
  if [[ "$IS_LXC" == "true" ]]; then
    local apparmor
    apparmor=$(cat /proc/self/attr/current 2>/dev/null | tr -d '\0' || echo "unconfined")
    [[ "$apparmor" != "unconfined" ]] && \
      warn "LXC AppArmor is '${apparmor}', not 'unconfined' — Chromium/VNC may fail. Host fix: /etc/pve/lxc/<ID>.conf → lxc.apparmor.profile: unconfined"
    unshare --user echo ok &>/dev/null \
      || warn "LXC user namespaces are blocked — Chromium/VNC may fail. Host fix: pct set <CTID> --features keyctl=1,nesting=1 && pct restart <CTID>"
  fi
  local out
  out=$(run_chromium_smoke "$svc_user" "$chromium_bin")
  if echo "$out" | grep -q "<html"; then
    success "Chromium smoke test passed as ${svc_user}"
  else
    warn "Chromium did not start cleanly as ${svc_user} — VNC login and the bot may fail at runtime. Diagnose with a full install: sudo bash install.sh"
  fi
}

# Write the websockify systemd unit: serves the noVNC statics and token-routes
# ?token=<ws> to that workspace's Xvnc RFB port. Runs as the service user, on
# loopback only (nginx fronts it). Mirrors docker/entrypoint.sh line 58.
write_websockify_service() {
  local svc_user="$1" svc_home="$2" workspace="$3"
  local token_dir="${workspace}/.temp/vnc-tokens"
  cat > "/etc/systemd/system/${VNC_SERVICE_NAME}.service" <<EOF
[Unit]
Description=Kleinanzeigen Bot UI — noVNC websockify bridge
After=network.target

[Service]
Type=simple
User=${svc_user}
Environment=HOME=${svc_home}
ExecStartPre=+/bin/mkdir -p ${token_dir}
ExecStartPre=+/bin/chown ${svc_user}:${svc_user} ${token_dir}
ExecStartPre=/bin/sh -c 'rm -f ${token_dir}/* 2>/dev/null || true'
ExecStart=/usr/bin/env python3 -m websockify --web=${NOVNC_DIR} --token-plugin TokenFile --token-source ${token_dir} 127.0.0.1:${WEBSOCKIFY_PORT}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable "${VNC_SERVICE_NAME}" &>/dev/null || true
  # The VNC bridge is optional: never let its start failure abort the whole
  # install/update (set -e). The GUI, nginx and the bot must come up regardless.
  systemctl restart "${VNC_SERVICE_NAME}" \
    || warn "VNC bridge (${VNC_SERVICE_NAME}) failed to start — GUI and bot still run; VNC login stays unavailable until fixed. Check: journalctl -u ${VNC_SERVICE_NAME} -n 50"
}

# Debian/Ubuntu ship an nginx.conf that already does `include /etc/nginx/conf.d/*.conf;`,
# so our site file (written into conf.d/) is picked up automatically. Arch's stock nginx.conf
# does NOT include conf.d/ — it ships its own inline `server { listen 80; }` instead. Without
# the include, our site is written but silently never loaded: `nginx -t` still passes, the GUI
# and /bot-browser/ proxy simply don't exist. Idempotently ensure the include lives in http{}.
ensure_nginx_confd_include() {
  local main_conf="/etc/nginx/nginx.conf"
  [ -f "$main_conf" ] || return 0
  # Already includes conf.d/*.conf → nothing to do (Debian/Ubuntu default).
  grep -Eq 'include[[:space:]]+[^;]*conf\.d/\*\.conf' "$main_conf" && return 0
  if grep -Eq '^[[:space:]]*http[[:space:]]*\{' "$main_conf"; then
    # Insert the include right after the first `http {` line. awk (not sed) keeps this portable
    # and testable; write to a temp file then move so a partial write never truncates nginx.conf.
    awk '!done && /^[[:space:]]*http[[:space:]]*\{/ { print; print "    include /etc/nginx/conf.d/*.conf;"; done=1; next } { print }' \
      "$main_conf" > "${main_conf}.katmp" && mv "${main_conf}.katmp" "$main_conf"
    info "Patched ${main_conf}: added 'include conf.d/*.conf' (was missing — typical on Arch)."
  else
    warn "No http{} block found in ${main_conf}; the reverse-proxy site may not load. Add 'include /etc/nginx/conf.d/*.conf;' manually."
  fi
}

# Write the nginx same-origin reverse-proxy site and validate its syntax.
# Does NOT start nginx (the caller starts it only AFTER the app has been moved
# off the public port, to avoid a bind conflict / lockout). Returns non-zero if
# `nginx -t` fails so the caller can decide whether to abort or keep the old setup.
write_nginx_site() {
  local public_port="$1" app_port="$2"
  # Remove the stock Debian default site so it cannot conflict on the public port
  # or serve the nginx welcome page.
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  cat > "$NGINX_SITE_FILE" <<EOF
# Same-origin proxy: nginx owns the public port, forwards / to the Next.js app
# (loopback) and /bot-browser/ to websockify so the GUI can embed noVNC in an
# iframe without cross-origin frame blocks. Mirrors docker/nginx.conf.
map \$http_upgrade \$ka_conn_upgrade { default upgrade; '' close; }
server {
    listen ${public_port};

    location /bot-browser/ {
        proxy_pass http://127.0.0.1:${WEBSOCKIFY_PORT}/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$ka_conn_upgrade;
        proxy_set_header Host \$host;
        proxy_read_timeout 86400s;
    }

    location / {
        proxy_pass http://127.0.0.1:${app_port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$ka_conn_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;
    }
}
EOF
  ensure_nginx_confd_include
  nginx -t &>/dev/null
}

# Write (or rewrite) the main app systemd unit. The app binds loopback:app_port;
# nginx fronts public_port. PUBLIC_PORT is recorded so a later --update recovers
# the public port after the app's own PORT env has become the internal port.
# CHROMIUM_BIN is exported so vnc/lifecycle.ts finds Chromium on any distro.
write_main_service() {
  local svc_user="$1" svc_home="$2" standalone="$3" workspace="$4" \
        bot_bin="$5" node_bin="$6" chromium_bin="$7" \
        app_port="$8" public_port="$9" cookie_secure="${10}" \
        bind_host="${11:-127.0.0.1}"
  cat > "/etc/systemd/system/kleinanzeigen-bot-ui.service" <<EOF
[Unit]
Description=Kleinanzeigen Bot UI
After=network.target

[Service]
Type=simple
User=${svc_user}
WorkingDirectory=${standalone}
Environment=HOME=${svc_home}
Environment=BOT_DIR=${workspace}
Environment=BOT_CMD=${bot_bin}
Environment=CHROMIUM_BIN=${chromium_bin}
Environment=PORT=${app_port}
Environment=PUBLIC_PORT=${public_port}
Environment=HOSTNAME=${bind_host}
Environment=NODE_ENV=production
Environment=NEXT_TELEMETRY_DISABLED=1
Environment=TZ=${TZ:-Europe/Berlin}
$([[ "$cookie_secure" == "true" ]] && echo "Environment=COOKIE_SECURE=true")
ExecStart=${node_bin} server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable kleinanzeigen-bot-ui &>/dev/null || true
}

# True if SOMETHING is listening on the given TCP port (any interface). Used to tell a real
# nginx bind failure apart from a healthy nginx whose backend app is still booting. If ss is
# unavailable we return success (assume listening) so we never disable a working nginx blindly.
port_listening() {
  local port="$1"
  command -v ss >/dev/null 2>&1 || return 0
  ss -ltn 2>/dev/null | grep -qE ":${port}[[:space:]]"
}

# After nginx is (re)started, verify the public port actually serves the app THROUGH nginx.
# `nginx -t` only checks syntax, not that nginx could BIND the port. Two failure modes must be
# told apart: (a) nginx is up and bound but the APP is still booting (nginx returns 502) — just
# wait/warn, NEVER disable a healthy nginx; (b) nothing is listening on the port (nginx crashed
# or the port is held by something else) — a real lockout, so fall back to binding the app
# directly on the public port (noVNC proxy disabled, but the GUI stays reachable).
verify_public_or_fallback() {
  local public_port="$1"
  local ping="http://127.0.0.1:${public_port}/api/system/ping"
  # Generous window: a cold Next.js start on a slow ARM/VM host can take well over 20s.
  for _ in {1..20}; do
    if curl -fsS -o /dev/null "$ping" 2>/dev/null; then
      success "nginx serves the app on port ${public_port}"
      return 0
    fi
    sleep 3
  done

  # (a) nginx healthy + bound, app just not answering (502/slow boot) → do NOT disable nginx.
  if systemctl is-active --quiet nginx && port_listening "$public_port"; then
    warn "nginx is bound to port ${public_port}, but the app isn't answering yet (still 502/booting)."
    warn "Leaving nginx running — likely a slow or failing app start. Check: journalctl -u kleinanzeigen-bot-ui -n 50"
    return 0
  fi

  # (b) nothing listening on the port → real lockout → rebind the app directly.
  warn "Nothing is listening on port ${public_port} — the app is loopback-only and would be unreachable."
  if command -v ss >/dev/null 2>&1; then
    warn "Current listeners on port ${public_port}:"
    ss -ltnp "sport = :${public_port}" 2>/dev/null | sed 's/^/    /' || true
  fi
  warn "Falling back to binding the app directly on port ${public_port} (noVNC login proxy disabled)."
  # The installer owns nginx exclusively (it writes its own site and removes the distro default),
  # so disabling it system-wide is intended on a dedicated host. On a SHARED nginx host this would
  # also stop other sites — this installer targets dedicated VMs/NAS appliances only.
  systemctl stop nginx 2>/dev/null || true
  systemctl disable nginx &>/dev/null || true
  # app_port == public_port and bind_host 0.0.0.0 → the app serves the public port itself.
  write_main_service "$SERVICE_USER" "$SERVICE_HOME" "$STANDALONE_DIR" "$WORKSPACE_DIR" \
    "$BOT_BIN" "$NODE_BIN" "$CHROMIUM_BIN" "$public_port" "$public_port" "$COOKIE_SECURE" "0.0.0.0"
  systemctl restart kleinanzeigen-bot-ui || true
  for _ in {1..20}; do
    if curl -fsS -o /dev/null "$ping" 2>/dev/null; then
      warn "Recovered: GUI reachable directly on port ${public_port}, but noVNC login is DISABLED."
      warn "Free port ${public_port} of the conflicting service, then re-run: bash install.sh --update"
      return 0
    fi
    sleep 3
  done
  error "App unreachable on port ${public_port} even after fallback — check: journalctl -u kleinanzeigen-bot-ui -n 50"
}

# Fast-forward the install dir to upstream. `git checkout -- .` only discards TRACKED changes, so
# an untracked file that upstream now ships, or a diverged local history, makes `--ff-only` fail.
# Under `set -e` that aborts --update mid-run with a cryptic git error and no recovery hint. Catch
# it and abort cleanly with an actionable message instead.
git_update_or_abort() {
  git -C "$INSTALL_DIR" checkout -- . 2>/dev/null || true
  local out
  if ! out=$(git -C "$INSTALL_DIR" pull --ff-only 2>&1); then
    echo "$out" | sed 's/^/  /'
    local branch
    branch=$(git -C "$INSTALL_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)
    error "git pull --ff-only failed for ${INSTALL_DIR} — likely an untracked-file collision or a diverged local history.
  Inspect:  git -C ${INSTALL_DIR} status
  Recover:  git -C ${INSTALL_DIR} reset --hard origin/${branch}   (discards local code changes in the install dir)
  Then re-run: bash install.sh --update"
  fi
}

# True if the full VNC topology is already provisioned (used by --update to decide
# whether an up-to-date install still needs a one-time VNC migration).
vnc_stack_present() {
  [[ -f "$NOVNC_DIR/vnc.html" ]] || return 1
  [[ -f "$NGINX_SITE_FILE" ]] || return 1
  [[ -f "/etc/systemd/system/${VNC_SERVICE_NAME}.service" ]] || return 1
  systemctl show kleinanzeigen-bot-ui -p Environment --value 2>/dev/null | grep -q "PUBLIC_PORT=" || return 1
  return 0
}

TOTAL_STEPS=8

# ─── Root check ──────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Run as root: sudo bash install.sh"

echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║   Kleinanzeigen-Bot UI — Installer               ║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════╝${RESET}"
echo ""

# ─── Update mode (--update): check version, pull if newer, build + restart ───
if [[ "$UPDATE_MODE" == "true" ]]; then
  TOTAL_STEPS=5
  # Detect package manager (fresh-install step 1 is skipped in --update mode)
  if [[ -f /etc/os-release ]]; then
    source /etc/os-release
    if [[ "${ID:-}" == "arch" ]] || echo "${ID_LIKE:-}" | grep -q "arch"; then
      PKG_MANAGER="pacman"
    else
      PKG_MANAGER="apt"
    fi
  else
    PKG_MANAGER="apt"
  fi
  # Auto-detect install dir from running service if not set via env
  if [[ -z "${INSTALL_DIR:-}" ]]; then
    SERVICE_WORKDIR=$(systemctl show kleinanzeigen-bot-ui -p WorkingDirectory --value 2>/dev/null || echo "")
    if [[ -n "$SERVICE_WORKDIR" ]]; then
      INSTALL_DIR="${SERVICE_WORKDIR%/.next/standalone}"
    else
      INSTALL_DIR="/opt/kleinanzeigen-bot-ui"
    fi
  fi
  [[ ! -d "$INSTALL_DIR/.git" ]] && error "No installation found at $INSTALL_DIR — run without --update first"
  NODE_BIN=$(command -v node 2>/dev/null) || error "Node.js not found — run full installer first"

  # Derive service parameters from the existing unit so the VNC migration keeps
  # the user's chosen user/workspace/port. Environment is a space-separated list.
  UNIT_ENV=$(systemctl show kleinanzeigen-bot-ui -p Environment --value 2>/dev/null || echo "")
  # `|| true`: a missing key makes grep exit 1, which under `set -euo pipefail` would
  # otherwise abort the whole --update run silently at the VAR=$(get_unit_env ...) line.
  get_unit_env() { echo "$UNIT_ENV" | tr ' ' '\n' | grep -oP "^$1=\K.*" | head -1 || true; }
  SERVICE_USER=$(systemctl show kleinanzeigen-bot-ui -p User --value 2>/dev/null || echo "")
  [[ -z "$SERVICE_USER" ]] && SERVICE_USER="botuser"
  WORKSPACE_DIR=$(get_unit_env BOT_DIR)
  BOT_BIN=$(get_unit_env BOT_CMD)
  # Guard: if critical env vars could not be derived, abort rather than write broken unit files
  [[ -z "$WORKSPACE_DIR" ]] && error "Could not derive BOT_DIR (workspace) from the running service — run the full installer once: sudo bash install.sh"
  [[ -z "$BOT_BIN" ]] && error "Could not derive BOT_CMD (bot binary) from the running service — run the full installer once: sudo bash install.sh"
  SERVICE_HOME=$(get_unit_env HOME)
  [[ -z "$SERVICE_HOME" ]] && SERVICE_HOME=$(getent passwd "$SERVICE_USER" | cut -d: -f6)
  COOKIE_SECURE=$(get_unit_env COOKIE_SECURE); [[ -z "$COOKIE_SECURE" ]] && COOKIE_SECURE="false"
  # Public port: prefer the recorded PUBLIC_PORT (set by a prior migration); on a
  # pre-VNC unit only PORT exists and it still IS the public port.
  CUR_PUBLIC=$(get_unit_env PUBLIC_PORT)
  CUR_PORT=$(get_unit_env PORT)
  PUBLIC_PORT="${CUR_PUBLIC:-${CUR_PORT:-3737}}"
  compute_app_internal_port "$PUBLIC_PORT"
  STANDALONE_DIR="$INSTALL_DIR/.next/standalone"
  # Chromium path for the unit's CHROMIUM_BIN (consumed by vnc/lifecycle.ts).
  # Prefer the value the initial full install already wrote to config.yaml
  # (browser.binary_location — the source of truth), then a live PATH detect,
  # else fail loudly instead of baking in an unverified /usr/bin/chromium guess.
  CHROMIUM_BIN=$(python3 -c "import yaml; d=yaml.safe_load(open('$WORKSPACE_DIR/config.yaml')) or {}; print((d.get('browser') or {}).get('binary_location') or '')" 2>/dev/null || echo "")
  [[ -z "$CHROMIUM_BIN" ]] && detect_chromium_bin
  [[ -z "$CHROMIUM_BIN" ]] && error "Could not determine the Chromium path (config.yaml browser.binary_location empty and none found on PATH) — run the full installer: sudo bash install.sh"

  TOTAL_MEM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)
  if [[ "$TOTAL_MEM_MB" -lt 2048 ]]; then
    export NODE_OPTIONS="--max-old-space-size=$((TOTAL_MEM_MB / 2))"
    info "NODE_OPTIONS set to --max-old-space-size=$((TOTAL_MEM_MB / 2))"
  fi

  AVAIL_DISK_MB=$(df -m / | awk 'NR==2 {print $4}')
  if [[ "$AVAIL_DISK_MB" -lt 1024 ]]; then
    warn "Low disk: ${AVAIL_DISK_MB}MB available — rebuild needs ~1GB free."
  fi

  step 1 "Checking for updates"
  # Read from git object store (immune to working-tree edits of package.json)
  LOCAL_VERSION=$(git -C "$INSTALL_DIR" show HEAD:package.json 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['version'])" 2>/dev/null || \
    python3 -c "import json; print(json.load(open('$INSTALL_DIR/package.json'))['version'])" 2>/dev/null || echo "")
  REMOTE_VERSION=$(curl --max-time 10 -fsSL "https://raw.githubusercontent.com/bkd3sign/kleinanzeigen-bot-ui/main/package.json" 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['version'])" 2>/dev/null || echo "")

  NEEDS_PULL=true
  if [[ -z "$LOCAL_VERSION" ]]; then
    warn "Could not read local version from package.json — proceeding anyway"
  elif [[ -z "$REMOTE_VERSION" ]]; then
    warn "Could not fetch remote version from GitHub — proceeding anyway"
  elif [[ "$LOCAL_VERSION" == "$REMOTE_VERSION" ]]; then
    if vnc_stack_present; then
      success "Already up to date (v${LOCAL_VERSION}) — VNC stack present"
      echo ""
      exit 0
    fi
    info "Already on v${LOCAL_VERSION}, but the VNC stack is not provisioned — enabling it now."
    NEEDS_PULL=false
  else
    info "Update available: v${LOCAL_VERSION} → v${REMOTE_VERSION}"
  fi

  if [[ "$NEEDS_PULL" == "true" ]]; then
    step 2 "Pulling latest changes"
    git_update_or_abort
    success "Repository updated"

    step 3 "Rebuilding application"
    cd "$INSTALL_DIR"
    info "Installing npm dependencies..."
    npm ci 2>&1 | tail -3
    info "Building Next.js app..."
    npm run build 2>&1 | tail -20
    info "Copying static assets..."
    cp -r public "$STANDALONE_DIR/public"
    cp -r .next/static "$STANDALONE_DIR/.next/static"
    mkdir -p "$STANDALONE_DIR/node_modules"
    cp -r node_modules/ws "$STANDALONE_DIR/node_modules/ws"
    success "Build complete"
  else
    info "Skipping pull/rebuild — code already current."
  fi

  # Single-command self-update: re-exec the freshly pulled installer once if its
  # INSTALLER_REV differs, so one --update applies the new logic (loop guard: _KA_REEXECED).
  if [[ "$NEEDS_PULL" == "true" && -z "${_KA_REEXECED:-}" ]]; then
    DISK_REV=$(grep -m1 '^INSTALLER_REV=' "$INSTALL_DIR/install.sh" 2>/dev/null | tr -dc '0-9')
    if [[ -n "$DISK_REV" && "$DISK_REV" != "$INSTALLER_REV" ]]; then
      info "Installer self-updated — re-running the new version..."
      exec env _KA_REEXECED=1 bash "$INSTALL_DIR/install.sh" --update
    fi
  fi

  step 4 "Provisioning VNC stack"
  mkdir -p "$WORKSPACE_DIR/bot" "$WORKSPACE_DIR/ads" "$WORKSPACE_DIR/users" "$WORKSPACE_DIR/.temp"
  ensure_vnc_packages
  ensure_novnc_static
  vnc_preflight_check "$SERVICE_USER" "$CHROMIUM_BIN"
  if [[ -f "$WORKSPACE_DIR/config.yaml" ]]; then
    write_browser_config "$WORKSPACE_DIR/config.yaml" "$CHROMIUM_BIN"
    if [[ "$SERVICE_USER" != "root" ]]; then
      chmod 600 "$WORKSPACE_DIR/config.yaml"
      chown "$SERVICE_USER:$SERVICE_USER" "$WORKSPACE_DIR/config.yaml"
    fi
  fi
  write_websockify_service "$SERVICE_USER" "$SERVICE_HOME" "$WORKSPACE_DIR"
  if write_nginx_site "$PUBLIC_PORT" "$APP_INTERNAL_PORT"; then
    # Move the app to loopback FIRST (frees the public port), then bind nginx.
    write_main_service "$SERVICE_USER" "$SERVICE_HOME" "$STANDALONE_DIR" "$WORKSPACE_DIR" \
      "$BOT_BIN" "$NODE_BIN" "$CHROMIUM_BIN" "$APP_INTERNAL_PORT" "$PUBLIC_PORT" "$COOKIE_SECURE"
    VNC_MIGRATED=true
    success "VNC stack provisioned (nginx → app + noVNC)"
  else
    VNC_MIGRATED=false
    nginx -t 2>&1 | sed 's/^/  /'
    warn "nginx config test failed — leaving the app on port ${PUBLIC_PORT}; VNC not enabled."
    warn "Fix the nginx error above and re-run: bash install.sh --update"
  fi

  step 5 "Restarting services"
  systemctl restart kleinanzeigen-bot-ui || true
  if [[ "$VNC_MIGRATED" == "true" ]]; then
    systemctl enable nginx &>/dev/null || true
    systemctl restart nginx || warn "nginx restart failed — check: journalctl -u nginx -n 50"
  fi
  STARTED=false
  for _ in {1..10}; do
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

  # Only the VNC-migrated path hands the public port to nginx; verify it bound (and fall back
  # to a direct app bind if not) so an --update can never leave the GUI unreachable.
  if [[ "$VNC_MIGRATED" == "true" ]]; then
    verify_public_or_fallback "$PUBLIC_PORT"
  fi

  # Read from git object store post-pull to reflect the actual installed version
  NEW_VERSION=$(git -C "$INSTALL_DIR" show HEAD:package.json 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['version'])" 2>/dev/null || echo "${REMOTE_VERSION}")
  IP=$(hostname -I | awk '{print $1}')
  PORT="$PUBLIC_PORT"
  echo ""
  echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════╗${RESET}"
  echo -e "${GREEN}${BOLD}║   Update complete!                               ║${RESET}"
  echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════╝${RESET}"
  echo ""
  echo -e "  ${BOLD}Version:${RESET} v${NEW_VERSION}"
  echo -e "  ${BOLD}Web UI:${RESET}  http://${IP}:${PORT}"
  echo -e "  ${BOLD}Bot binary:${RESET} unchanged — update via Admin → Bot-Update in the web UI"
  echo ""
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
step 1 "Detecting system & container environment"
# ─────────────────────────────────────────────────────────────────────────────

# Detect LXC
detect_lxc

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
  # head -1 after grep: aarch64 ldd may produce multiple regex matches on one line
  GLIBC_VERSION=$(ldd --version 2>/dev/null | head -1 | grep -oP '\d+\.\d+$' | head -1 || echo "0.0")
  GLIBC_MINOR=$(echo "$GLIBC_VERSION" | cut -d. -f2 | tr -d '[:space:]')
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

# LXC AppArmor + namespace check
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

  if ! unshare --user echo ok &>/dev/null; then
    echo ""
    echo -e "${YELLOW}${BOLD}  ⚠ User namespaces are blocked in this LXC container!${RESET}"
    echo -e "  Chromium needs kernel namespace support to start."
    echo ""
    echo -e "  Fix on the Proxmox host:"
    echo -e "    ${BOLD}pct set <CTID> --features keyctl=1,nesting=1${RESET}"
    echo -e "    ${BOLD}pct restart <CTID>${RESET}"
    echo -e "  Then re-run this script."
    echo ""
    if [[ "$NON_INTERACTIVE" == "false" ]]; then
      read -r -p "  Continue anyway? [y/N] " CONTINUE
      [[ "${CONTINUE,,}" != "y" ]] && exit 0
    fi
  else
    success "User namespaces: available (OK for Chromium)"
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_DIR="${INSTALL_DIR:-/opt/kleinanzeigen-bot-ui}"
if [[ -f "$SCRIPT_DIR/package.json" ]] && grep -q "kleinanzeigen-bot-ui" "$SCRIPT_DIR/package.json" 2>/dev/null; then
  DEFAULT_INSTALL_DIR="$SCRIPT_DIR"
fi

IS_REINSTALL=false
if [[ -f "$DEFAULT_INSTALL_DIR/package.json" ]] && grep -q "kleinanzeigen-bot-ui" "$DEFAULT_INSTALL_DIR/package.json" 2>/dev/null; then
  EXISTING_VERSION=$(python3 -c "import json; print(json.load(open('$DEFAULT_INSTALL_DIR/package.json'))['version'])" 2>/dev/null || echo "unknown")
  echo ""
  echo -e "${YELLOW}${BOLD}  ⚠ Existing installation detected (v${EXISTING_VERSION}) at ${DEFAULT_INSTALL_DIR}${RESET}"
  echo -e "  Running install again will do a full reinstall (~10 min)."
  echo -e "  Your workspace data (config, ads) will NOT be affected."
  echo -e "  Use this to change service user, port, or repair a broken installation."
  echo -e "  For a quick version update use instead:"
  echo -e "    ${BOLD}bash install.sh --update${RESET}"
  echo ""
  if [[ "$NON_INTERACTIVE" == "false" ]]; then
    read -r -p "  Continue with full reinstall? [y/N] " REINSTALL_CONFIRM
    [[ "${REINSTALL_CONFIRM,,}" != "y" ]] && exit 0
  fi
  IS_REINSTALL=true
fi

if [[ "$NON_INTERACTIVE" == "false" ]]; then
  echo ""
  echo -e "  Answer the following questions to configure your installation."
  echo -e "  Press ${BOLD}Enter${RESET} to accept the default shown in [brackets]."
  echo ""
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
[[ "$PORT" == "$WEBSOCKIFY_PORT" ]] && error "Port $PORT is reserved for the internal VNC bridge — choose another port."
# nginx fronts PUBLIC_PORT; the Next.js app runs on a loopback internal port.
PUBLIC_PORT="$PORT"
compute_app_internal_port "$PUBLIC_PORT"

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
if [[ "$NON_INTERACTIVE" == "false" ]]; then
  echo -e "  HTTPS / secure cookies:"
  echo -e "    ${BOLD}false${RESET} — local / LAN without HTTPS ${GREEN}(default, recommended for home servers)${RESET}"
  echo -e "    ${BOLD}true${RESET}  — behind an HTTPS reverse proxy (nginx, Caddy, Traefik…)"
  echo ""
fi
ask "COOKIE_SECURE (true/false)" "${COOKIE_SECURE:-false}" COOKIE_SECURE
[[ "$COOKIE_SECURE" == "true" || "$COOKIE_SECURE" == "false" ]] || { warn "Invalid value '$COOKIE_SECURE' — defaulting to false"; COOKIE_SECURE="false"; }

echo ""
echo -e "${BOLD}  Installation summary:${RESET}"
echo -e "    Install dir:    $INSTALL_DIR"
echo -e "    Workspace:      $WORKSPACE_DIR"
echo -e "    Port:           $PORT"
echo -e "    Service user:   $SERVICE_USER"
echo -e "    Bot release:    $BOT_RELEASE"
echo -e "    Secure cookies: $COOKIE_SECURE"
echo ""

if [[ "$NON_INTERACTIVE" == "false" ]] && [[ "$IS_REINSTALL" == "false" ]]; then
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
    curl -fsSL --max-time 60 https://deb.nodesource.com/setup_22.x | bash - \
      || warn "NodeSource setup failed — apt will fall back to the distro Node, which may be too old."
    apt-get install -y nodejs
    # Verify the install actually delivered Node 22+ instead of silently building against a
    # too-old distro Node later (which fails deep in `next build` with a cryptic error).
    NODE_MAJOR=$(node --version 2>/dev/null | grep -oP '\d+' | head -1 || echo "0")
    [[ "$NODE_MAJOR" -lt 22 ]] && error "Node.js 22+ required but found v${NODE_MAJOR}. Install Node 22+ manually and re-run: bash install.sh --update"
  fi

  # Ubuntu ships chromium as a snap transitional package which cannot run inside
  # a headless systemd service (requires user session / cgroup context).
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
  pacman -Sy --noconfirm --needed curl git nodejs npm chromium python python-yaml procps-ng noto-fonts ttf-liberation
fi

# Install the VNC/nginx stack (Xvnc + websockify + noVNC + nginx) so LXC/bare-metal
# installs get the same manual-login-over-VNC capability as Docker.
ensure_vnc_packages
ensure_novnc_static

NODE_BIN=$(command -v node) || error "node binary not found after installation"
success "Node.js $(node --version) at $NODE_BIN"

# Detect Chromium binary — prefer non-snap over snap
detect_chromium_bin
[[ -z "$CHROMIUM_BIN" ]] && error "Chromium not found after installation"
success "Chromium: $CHROMIUM_BIN"

# Verify Chromium binary is executable
if ! timeout 5 "$CHROMIUM_BIN" --version &>/dev/null; then
  error "Chromium binary not executable: $CHROMIUM_BIN"
fi
success "Chromium binary OK: $($CHROMIUM_BIN --version 2>/dev/null | head -1)"

# ─────────────────────────────────────────────────────────────────────────────
step 4 "Setting up service user and directories"
# ─────────────────────────────────────────────────────────────────────────────

if [[ "$SERVICE_USER" != "root" ]]; then
  if ! id "$SERVICE_USER" &>/dev/null; then
    info "Creating user: $SERVICE_USER"
    useradd -r -m -s /bin/bash "$SERVICE_USER"
    success "User created: $SERVICE_USER"
  else
    USER_HOME=$(getent passwd "$SERVICE_USER" | cut -d: -f6)
    USER_SHELL=$(getent passwd "$SERVICE_USER" | cut -d: -f7)
    REPAIRED=false
    if [[ ! -d "$USER_HOME" || "$USER_HOME" == "/nonexistent" ]]; then
      info "Repairing home directory for $SERVICE_USER (was: $USER_HOME)..."
      usermod -d "/home/$SERVICE_USER" "$SERVICE_USER"
      mkdir -p "/home/$SERVICE_USER"
      chown "$SERVICE_USER:$SERVICE_USER" "/home/$SERVICE_USER"
      REPAIRED=true
    fi
    if [[ "$USER_SHELL" == */nologin || "$USER_SHELL" == */false ]]; then
      info "Repairing shell for $SERVICE_USER (was: $USER_SHELL)..."
      usermod -s /bin/bash "$SERVICE_USER"
      REPAIRED=true
    fi
    if [[ "$REPAIRED" == "true" ]]; then
      success "User repaired: $SERVICE_USER (home: $(getent passwd "$SERVICE_USER" | cut -d: -f6), shell: /bin/bash)"
    else
      success "User OK: $SERVICE_USER"
    fi
  fi
fi

mkdir -p \
  "$WORKSPACE_DIR/bot" \
  "$WORKSPACE_DIR/ads" \
  "$WORKSPACE_DIR/users" \
  "$WORKSPACE_DIR/.temp"

success "Workspace directories created at $WORKSPACE_DIR"

# Chromium smoke test as service user — verifies the real runtime scenario
info "Testing Chromium as service user ${SERVICE_USER}..."
CHROMIUM_USER_TEST=$(run_chromium_smoke "$SERVICE_USER" "$CHROMIUM_BIN")
if echo "$CHROMIUM_USER_TEST" | grep -q "<html"; then
  success "Chromium test passed as ${SERVICE_USER}"
elif echo "$CHROMIUM_USER_TEST" | grep -qi "apparmor\|permission denied\|operation not permitted"; then
  echo ""
  echo -e "${RED}${BOLD}  ✗ Chromium blocked — AppArmor or permission issue${RESET}"
  echo "$CHROMIUM_USER_TEST" | grep -i "error\|denied\|apparmor" | head -3 | sed 's/^/  /'
  echo ""
  echo -e "  Fix on the Proxmox host:"
  echo -e "  ${BOLD}    /etc/pve/lxc/<ID>.conf  →  lxc.apparmor.profile: unconfined${RESET}"
  exit 1
elif echo "$CHROMIUM_USER_TEST" | grep -qi "namespace\|clone\|unshare"; then
  echo ""
  echo -e "${RED}${BOLD}  ✗ Chromium blocked — kernel namespaces not available${RESET}"
  echo -e "  Fix on the Proxmox host:"
  echo -e "  ${BOLD}    pct set <CTID> --features keyctl=1,nesting=1${RESET}"
  exit 1
else
  echo ""
  echo -e "${RED}${BOLD}  ✗ Chromium test failed as ${SERVICE_USER}${RESET}"
  echo "$CHROMIUM_USER_TEST" | head -10 | sed 's/^/  /'
  echo ""
  echo -e "  Debug manually:"
  echo -e "  ${BOLD}    su -s /bin/bash ${SERVICE_USER} -c \"${CHROMIUM_BIN} --headless --no-sandbox --dump-dom about:blank\"${RESET}"
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
step 5 "Building application"
# ─────────────────────────────────────────────────────────────────────────────

# Full reinstall: always wipe and re-clone for a guaranteed clean state
if [[ "$IS_REINSTALL" == "true" && -d "$INSTALL_DIR" ]]; then
  info "Wiping existing installation for clean reinstall..."
  rm -rf "$INSTALL_DIR"
fi

if [[ -d "$INSTALL_DIR/.git" ]]; then
  # Fresh install where a git repo already exists — pull latest
  git -C "$INSTALL_DIR" checkout -- . 2>/dev/null || true
  LOCAL_VERSION=$(git -C "$INSTALL_DIR" show HEAD:package.json 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['version'])" 2>/dev/null || \
    python3 -c "import json; print(json.load(open('$INSTALL_DIR/package.json'))['version'])" 2>/dev/null || echo "")
  REMOTE_VERSION=$(curl --max-time 10 -fsSL "https://raw.githubusercontent.com/bkd3sign/kleinanzeigen-bot-ui/main/package.json" 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['version'])" 2>/dev/null || echo "")
  if [[ -n "$LOCAL_VERSION" && -n "$REMOTE_VERSION" && "$LOCAL_VERSION" == "$REMOTE_VERSION" ]]; then
    info "Already on latest version (v${LOCAL_VERSION}) — using existing source"
  else
    info "Pulling latest changes from GitHub..."
    git_update_or_abort
    success "Repository updated"
  fi
else
  if [[ -d "$INSTALL_DIR" ]]; then
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
npm ci 2>&1 | tail -3
info "Building Next.js app..."
npm run build 2>&1 | tail -20

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
curl -fSL --max-time 300 "$BOT_URL" -o "$BOT_BIN" \
  || error "Bot binary download failed (network/proxy/GitHub unreachable) — could not fetch $BOT_URL. Retry once connectivity is restored."
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
write_browser_config "$CONFIG_FILE" "$CHROMIUM_BIN"
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

# Ensure the install directory and path to standalone are traversable by the service user
chmod 755 "$INSTALL_DIR"
chmod 755 "$INSTALL_DIR/.next"

# Warn if the parent directory is not world-traversable (common with custom install paths)
PARENT_DIR="$(dirname "$INSTALL_DIR")"
if [[ "$SERVICE_USER" != "root" ]] && ! su -s /bin/sh "$SERVICE_USER" -c "test -x '$PARENT_DIR'" 2>/dev/null; then
  warn "Directory $PARENT_DIR is not accessible for user $SERVICE_USER — fixing..."
  chmod 755 "$PARENT_DIR"
  success "Fixed permissions on $PARENT_DIR"
fi

chmod +x "$BOT_BIN"

if [[ "$SERVICE_USER" == "root" ]]; then
  SERVICE_HOME="/root"
else
  SERVICE_HOME=$(getent passwd "$SERVICE_USER" | cut -d: -f6)
fi

# 1) websockify bridge (loopback:6080) — no port conflict with the app.
info "Installing noVNC websockify service..."
write_websockify_service "$SERVICE_USER" "$SERVICE_HOME" "$WORKSPACE_DIR"

# 2) nginx site: write + validate ONLY (do not bind the public port yet, the app
#    may still hold it from a previous run/reinstall).
info "Writing nginx same-origin proxy config..."
if ! write_nginx_site "$PUBLIC_PORT" "$APP_INTERNAL_PORT"; then
  nginx -t 2>&1 | sed 's/^/  /'
  error "nginx configuration test failed — aborting before changing the app binding."
fi

# 3) Main app unit: app moves to loopback:APP_INTERNAL_PORT, freeing the public port.
info "Installing main application service..."
write_main_service "$SERVICE_USER" "$SERVICE_HOME" "$STANDALONE_DIR" "$WORKSPACE_DIR" \
  "$BOT_BIN" "$NODE_BIN" "$CHROMIUM_BIN" "$APP_INTERNAL_PORT" "$PUBLIC_PORT" "$COOKIE_SECURE"
systemctl restart kleinanzeigen-bot-ui || true

# 4) Now the public port is free — start nginx on it.
info "Starting nginx on port ${PUBLIC_PORT}..."
systemctl enable nginx &>/dev/null || true
systemctl restart nginx || warn "nginx restart failed — check: journalctl -u nginx -n 50"

# Wait up to 20s for the app service to start (slow on RPi)
STARTED=false
for _ in {1..10}; do
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

# Verify nginx actually serves the public port (binds, not just syntax-valid); on failure this
# rebinds the app directly so the box never becomes unreachable after the port hand-off.
verify_public_or_fallback "$PUBLIC_PORT"

if ! systemctl is-active --quiet "$VNC_SERVICE_NAME"; then
  warn "VNC bridge not active — check: journalctl -u ${VNC_SERVICE_NAME} -n 50"
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
echo -e "  ${BOLD}Proxy:${RESET}      nginx → app (127.0.0.1:${APP_INTERNAL_PORT}) + noVNC (/bot-browser/)"
echo -e "  ${BOLD}VNC login:${RESET}  available when the bot needs a manual login"
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
echo -e "    systemctl status ${VNC_SERVICE_NAME}    # noVNC bridge status"
echo -e "    systemctl status nginx                   # reverse-proxy status"
echo ""
if [[ "$COOKIE_SECURE" == "true" ]]; then
  echo -e "  ${GREEN}Secure cookies enabled${RESET} — HTTPS mode active."
  echo ""
fi
