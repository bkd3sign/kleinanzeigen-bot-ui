<div align="center">

# kleinanzeigen-bot-ui

**A self-hosted web interface for [kleinanzeigen-bot](https://github.com/Second-Hand-Friends/kleinanzeigen-bot)**

Manage ads, run bot commands, generate listings with AI, and track everything from a single dashboard.

[![Release](https://img.shields.io/github/v/release/bkd3sign/kleinanzeigen-bot-ui?label=release)](https://github.com/bkd3sign/kleinanzeigen-bot-ui/releases/latest)
[![Docker](https://img.shields.io/badge/docker-ghcr.io-blue)](https://github.com/bkd3sign/kleinanzeigen-bot-ui/pkgs/container/kleinanzeigen-bot-ui)
[![License](https://img.shields.io/badge/license-AGPL--3.0-green)](LICENSE)

**[Live Demo](https://demo-kleinanzeigen-bot-ui.bkd3sign.de/)**

</div>

---

## Table of Contents

- [Features](#features)
  - [Ad Management](#ad-management)
  - [Bot Control](#bot-control)
  - [Multi-User & Authentication](#multi-user--authentication)
  - [Templates](#templates)
  - [Dashboard & Analytics](#dashboard--analytics)
  - [Messaging](#messaging)
  - [Settings](#settings)
  - [Browser Extensions (CDP Injection)](#browser-extensions-cdp-injection)
- [API](#api)
- [Development](#development)
  - [Architecture](#architecture)
  - [Codebase](#codebase)
- [Deployment](#deployment)
  - [Option A — Docker, pre-built image (easiest)](#option-a--docker-pre-built-image-easiest)
  - [Option B — Docker, build from source](#option-b--docker-build-from-source)
  - [Option C — Linux / LXC without Docker](#option-c--linux--lxc-without-docker)
  - [Setup (all options)](#setup-all-options)
  - [Updates](#updates)
- [Security](#security)
- [Upstream](#upstream)
- [Tested On](#tested-on)
- [License](#license)

---

## Features

### Ad Management

- **Full CRUD** — Create, edit, duplicate, and delete ad listings via YAML
- **Grid & Table views** — Toggle between card layout and sortable table with persistent sort
- **Bulk actions** — Select multiple ads for publish, delete, or update in one operation
- **Image management** — Drag-drop upload, reorder, preview thumbnails, automatic Sharp compression
- **Search & filter** — Full-text search across titles and categories, filter by status or category
- **Category picker** — Hierarchical browser with 582 categories, search, and breadcrumb navigation

#### Ad Status System

Each ad has exactly one status, determined by priority:

| Priority | Status | Badge | Condition |
|----------|--------|-------|-----------|
| 1 | **Entwurf** | `muted` (gray) | No kleinanzeigen.de ID (never published) |
| 2 | **Abgelaufen** | `danger` (red) | Published > 60 days ago |
| 3 | **Läuft bald ab** | `warning` (orange) | Expires within 7 days |
| 4 | **Verwaist** | `warning` (orange) | Has ID but no longer found online (grayscale image) |
| 5 | **Geändert** | `info` (accent) | Content hash differs from stored hash |
| 6 | **Aktiv** | `success` (green, pulse) | Published and active |
| 7 | **Inaktiv** | `danger` (red) | Manually or automatically deactivated |

#### Ad Sync & Orphan Detection

After a successful `download --ads=all`, the system automatically:

1. **Collects online IDs** — Scans all downloaded ads to build the set of IDs that exist on kleinanzeigen.de
2. **Detects orphans** — Any local ad with an ID not in the online set is considered orphaned
3. **Migrates settings** — If an orphaned ad has a title+category match in the new downloads (re-published with new ID), user settings are transferred:
   - `auto_price_reduction`, `republication_interval`, `description_prefix/suffix`, `shipping_options`, `sell_directly`
   - Bot-managed fields (`repost_count`, `content_hash`, timestamps) are NOT migrated
4. **Removes duplicates** — The old orphaned file is deleted after successful migration
5. **Deactivates remaining orphans** — Ads without a match are set to `active: false`
6. **Persists state** — Online ID set is saved to `.last_download_all.json` (survives server restarts)

This ensures local state always matches what's online — no manual cleanup needed.

#### AI-Powered Ad Generation

- **Vision analysis** — Upload product photos, AI extracts details and generates a complete listing
- **Text generation** — Title (max 65 chars), structured description with bullet points, price estimation
- **Category auto-selection** — AI picks the best matching category from 582 categories
- **Attribute suggestions** — AI fills special attributes (color, size, condition) based on category and description
- **Shipping suggestions** — Carrier and cost recommendations based on item size
- **Price estimation** — Condition-based pricing derived from image analysis
- **Provider** — OpenRouter API (GPT-4.1-nano for text, GPT-4.1-mini for vision)

### Bot Control

- **All CLI commands** — Publish, download, update, extend, delete, verify, diagnose
- **Live logs** — Real-time output streaming via Server-Sent Events
- **Job management** — Cancel running/queued jobs, repeat completed jobs with one click
- **Bot self-update** — Update the bot binary directly from the UI (admin only)
- **Compatibility check** — Validates GUI compatibility with bot version before updates

#### Job Queue

The bot uses a **single-concurrency FIFO queue** — only one job runs at a time, additional jobs wait with a visible queue position. This is intentional:

- Each job opens a **headless Chromium browser** and logs into kleinanzeigen.de
- Parallel sessions would cause login conflicts, browser crashes, and YAML write races
- After each job completes, **post-job hooks** run automatically (orphan detection, duplicate migration)
- The next job starts only after hooks finish

#### MFA / Two-Factor Authentication

- **Automatic detection** — Bot detects when kleinanzeigen.de requires SMS or email verification
- **In-app MFA flow** — Banner notification + overlay modal for code submission
- **Session continuity** — Bot pauses at MFA prompt, resumes after code entry
- **Job status tracking** — Dedicated `mfa_required` state visible in job list and pill

#### Scheduling & Automation

- **Cron-based schedules** — Create recurring bot jobs with cron expressions
- **Preset times** — Daily (6/12/18 AM), every 6/12 hours, weekday-specific
- **All commands** — Schedule any bot command (publish, download, update, extend, verify)
- **Status tracking** — Last run, last status, next scheduled execution
- **Enable/disable** — Toggle schedules without deleting them

#### Auto Price Reduction

Automatically lower prices on each republication cycle:

- **Strategies** — Percentage-based (e.g., -10% per repost) or fixed amount (e.g., -15 EUR per repost)
- **Minimum price floor** — Price never drops below configured minimum (required when enabled)
- **Delay options** — Start reduction after N reposts or N days since first publication
- **Rounding** — All prices rounded to whole euros (commercial rounding, ROUND_HALF_UP)
- **Live preview** — Compact chip view or full timeline showing dates, repost numbers, and calculated prices
- **Validation warnings** — Alerts when reduction is ineffective due to rounding or config issues

> Price reductions only trigger on `publish` (delete + re-create). The `update` command does NOT reduce prices.

### Multi-User & Authentication

- **JWT-based auth** — Secure token authentication with bcrypt password hashing
- **Role system** — Admin (full access) and User (personal workspace only)
- **Workspace isolation** — Each user gets their own ads, config, templates, schedules, and browser profile
- **Invite system** — Admin generates invite links (7-day expiry) for registration
- **User management** — Admin can edit roles, reset passwords, delete users
- **Rate limiting** — Login, registration, and setup endpoints are rate-limited
- **Security headers** — CSP, HSTS, X-Frame-Options enforced

### Templates

- **Save as template** — Turn any ad into a reusable template with one click
- **Template CRUD** — Create, edit, delete templates with slug-based naming
- **Quick creation** — Create new ads pre-filled from template values (title, description, category, price, shipping)

### Dashboard & Analytics

- **Statistics grid** — Online count, drafts, orphaned, expiring soon, total value, average price, repost counts
- **Health indicators** — Missing images, inactive ads, price at minimum, no description
- **Schedule calendar** — 7-day visual calendar showing upcoming republications and expirations
- **Charts** — Price distribution histogram, category breakdown bars, status distribution donut
- **Performance metrics** — Top repost ads, time-on-market bars, price reduction tracking

### Messaging

- **Inbox** — Split-panel view with conversation list and chat (responsive, mobile-optimized)
- **Real-time chat** — Send and receive messages with optimistic rendering (instant feedback)
- **AI auto-responder** — Automatic or review-mode reply generation via LLM (OpenRouter)
- **AI message tracking** — AI-sent messages shown with purple bubble and icon to distinguish from manual messages
- **Escalation detection** — Custom keywords and scheduling requests trigger manual review
- **Pending review** — Edit, approve, or reject AI-generated replies before sending
- **Anti-bot detection** — Random response delays (30–120s) and poll jitter (20–35s)

### Settings

- **Login credentials** — kleinanzeigen.de username/password (per user in multi-user mode)
- **Contact defaults** — Name, phone, address, zip/location with PLZ autocomplete
- **Ad defaults** — Type, price type, shipping type, direct sell
- **Republication interval** — Days between automatic reposts (default: 7)
- **Description prefix/suffix** — Text prepended/appended to all ad descriptions
- **AI messaging** — Mode (auto/review/off), API key, model, escalation keywords, availability, personality, custom rules



### Browser Extensions (CDP Injection)

Chrome extensions don't work with the bot's automation library (nodriver sets `--test-type` which disables extension loading). As a workaround, JavaScript fixes are injected directly via Chrome DevTools Protocol.

**How it works:** When the bot starts Chrome, the runner detects the CDP WebSocket port from the bot output and injects all enabled scripts via `Page.addScriptToEvaluateOnNewDocument`. Scripts run on every page navigation automatically.

**Configuration** (`extensions.yaml`):
```yaml
extensions:
  - name: Shipping Dialog Fix
    file: shipping-dialog-fix.js
    enabled: true        # set to false to disable
    description: Fixes shipping dialog selectors
```

**Adding a new script:** Place a `.js` file in `extensions/` and add an entry to `extensions.yaml`. **Removing:** Delete the entry and the file, or set `enabled: false`.

If `extensions.yaml` or the `extensions/` directory don't exist, the system is completely inactive and the bot runs normally.


---

## API

81 REST endpoints under `/api/`, covering:

- **Ads** — CRUD, duplicate, AI generation, category/price/attribute suggestions, templates
- **Bot** — Publish, download, update, extend, delete, verify, diagnose, version, MFA
- **Messaging** — Conversations, AI auto-responder, CDN image proxy
- **Images** — Upload, list, reorder, delete
- **Jobs** — Queue status, cancel, repeat
- **Schedules** — Cron automation CRUD
- **Auth** — JWT login, registration, password reset, invite system
- **Admin** — User management, invite management, messaging overview
- **System** — Health, setup wizard, config, categories, locations, compatibility
- **Logs** — Bot output, SSE streaming

---



## Development

```bash
npm install        # Install dependencies
npm run dev        # Start dev server (port 3000)
npm run test       # Run unit tests
npm run build      # Production build
npm run start      # Start production server
```

---

### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Docker Container (Debian Trixie + Node.js 22 + Chromium)        │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Next.js 15 (standalone)                          :3000  │    │
│  │                                                          │    │
│  │  ┌──────────────┐   ┌────────────────────────────────┐   │    │
│  │  │  React 19 UI │   │  API Routes                    │   │    │
│  │  │  TanStack Q  │──▶│  /api/ads      → YAML CRUD     │   │    │
│  │  │  CSS Modules │   │  /api/bot      → Bot Queue     │   │    │
│  │  │              │   │  /api/messages → Gateway API   │   │    │
│  │  │              │   │  /api/auth     → JWT Auth      │   │    │
│  │  └──────────────┘   └───────────┬────────────────────┘   │    │
│  └─────────────────────────────────┼────────────────────────┘    │
│                                    │                             │
│                          ┌─────────▼───────────┐                 │
│                          │  Job Queue (FIFO)   │                 │
│                          │  Single concurrency │                 │
│                          └─────────┬───────────┘                 │
│                                    │                             │
│    ┌────────────────┐    ┌─────────▼───────────┐                 │
│    │  Chromium      │◀───│  kleinanzeigen-bot  │                 │
│    │  headless      │    │  (child process)    │                 │
│    └───────┬────────┘    └─────────┬───────────┘                 │
│            │ CDP                   │                             │
│    ┌───────▼────────┐    ┌─────────▼──────────┐                  │
│    │  CDP Scripts   │    │  Post-Job Hooks    │                  │
│    │  (extensions/) │    │  Orphan detection  │                  │
│    └────────────────┘    │ Settings migration │                  │
│                          └────────────────────┘                  │
│                                                                  │
│  /workspace (volume mount)                                       │
│  ├── ads/                 Ad YAML files                          │
│  ├── bot/                 Bot binary                             │
│  ├── config.yaml          Bot login + settings                   │
│  ├── extensions/          Injected browser scripts               │
│  ├── extensions.yaml      CDP script config                      │
│  ├── schedules.yaml       Cron automation                        │
│  ├── users/               Per-user workspaces                    │
│  └── users.yaml           App users, roles & JWT secret          │
└──────────────────────────────────────────────────────────────────┘
```

#### Components

- **Frontend + Backend** — Next.js 15 App Router: React UI and API routes in a single process
- **Bot** — [kleinanzeigen-bot](https://github.com/Second-Hand-Friends/kleinanzeigen-bot) binary, spawned as async child process
- **Browser** — Headless Chromium for interacting with kleinanzeigen.de (one instance at a time)
- **CDP Scripts** — JavaScript fixes injected via Chrome DevTools Protocol for site compatibility
- **Data** — YAML files for ads, config, templates, schedules — organized in per-user workspaces
- **Process management** — Process groups for clean bot + chromium cleanup, orphaned process detection

#### Data Flow

```
User Action (UI)
  → API Route (validation + auth)
    → Bot Queue (FIFO, single concurrency)
      → Bot Process (Chromium + kleinanzeigen.de)
        → YAML files updated
          → Post-job hooks (orphan detection, migration)
            → Next job starts
```

#### Ad Sync Pipeline

```
download --ads=all completes successfully
  → Hook scans downloaded-ads/ → collects online IDs
  → Compares against all local ads with IDs
  → Orphans with title+category match → migrate settings, delete old file
  → Orphans without match → set active: false
  → Writes .last_download_all.json
  → GET /api/ads reads JSON → computes is_orphaned per ad
  → UI displays "Verwaist" badge + grayscale
```

---


### Codebase

```
kleinanzeigen-bot-ui/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (app)/              # Authenticated pages
│   │   │   ├── dashboard/      #   Statistics, charts, calendar
│   │   │   ├── ads/            #   Ad management (CRUD, AI, edit)
│   │   │   ├── bot/            #   Bot control panel
│   │   │   ├── jobs/           #   Job history & tracking
│   │   │   ├── templates/      #   Template management
│   │   │   ├── automation/     #   Cron schedule management
│   │   │   ├── messages/       #   Messaging inbox & chat
│   │   │   ├── logs/           #   Bot log viewer
│   │   │   ├── admin/          #   User & invite management
│   │   │   └── settings/       #   User settings & config
│   │   ├── (auth)/             # Login & registration
│   │   └── api/                # API route handlers
│   ├── components/             # React components (feature-grouped)
│   ├── contexts/               # React contexts (Auth, QueryProvider)
│   ├── hooks/                  # Custom React hooks (useSort, useAds, etc.)
│   ├── lib/                    # Server-side utilities
│   │   ├── ads/                #   Category attributes, pricing, status
│   │   ├── api/                #   Error handling, rate limiting
│   │   ├── auth/               #   JWT middleware, bcrypt, rate limiter
│   │   ├── bot/                #   Job queue, runner, hooks, scheduler
│   │   ├── images/             #   Upload, resize, resolve
│   │   ├── messaging/          #   Gateway API, AI responder, prompts
│   │   ├── security/           #   Input validation
│   │   └── yaml/               #   YAML read/write, config, users
│   ├── styles/                 # Global SCSS & CSS Modules
│   ├── types/                  # TypeScript definitions
│   └── validation/             # Zod schemas
├── docker/                     # Docker deployment
│   ├── Dockerfile              #   Multi-stage build (Node.js + Chromium + Bot)
│   ├── docker-compose.yml      #   Container config (ports, volumes, resources)
│   ├── entrypoint.sh           #   Container startup script
│   ├── config.example.yaml     #   Example configuration
│   └── build.sh                #   Export script for NAS/server deployment
├── extensions.yaml              # CDP script injection config (enable/disable fixes)
├── extensions/                  # Injected browser scripts (workarounds for bot bugs)
│   └── shipping-dialog-fix.js   #   Fixes shipping dialog selectors after site redesign
└── config.yaml                 # Bot config (gitignored, auto-generated on setup)
```

---

## Deployment

### Option A — Docker, pre-built image (easiest)

No clone required. Download only the `docker-compose.yml` and start:

```bash
mkdir kleinanzeigen-bot-ui && cd kleinanzeigen-bot-ui
curl -fsSL https://raw.githubusercontent.com/bkd3sign/kleinanzeigen-bot-ui/main/docker/docker-compose.yml -o docker-compose.yml
docker compose up -d
```

Docker pulls the pre-built image from [GitHub Container Registry](https://github.com/bkd3sign/kleinanzeigen-bot-ui/pkgs/container/kleinanzeigen-bot-ui) automatically. No build step needed.

---

### Option B — Docker, build from source

Clone the repo, build the image locally, and deploy to your server:

```bash
# On your local machine
./docker/build.sh
rsync -av docker/export/ user@server:/path/to/kleinanzeigen-bot-ui/

# On the server
docker compose up -d --build
```

Use this if you want to customize the Dockerfile or pin a specific bot version:

```bash
docker compose up -d --build --build-arg BOT_RELEASE=2025-05-15
```

**Container resources:**

| Resource | Value |
|----------|-------|
| Memory limit | 2 GB |
| Shared memory | 512 MB (required for Chromium) |
| tmpfs | 1 GB (`/tmp` scratch space) |
| Port mapping | `3737` (host) → `3000` (container) |
| Volume | `.:/workspace` — config, ads, bot binary, user data |

---

### Option C — Linux / LXC without Docker

A one-line installer — no clone required. It downloads the app, installs Node.js, Chromium, and the bot binary, then sets up a systemd service. No Docker required.

**Supported systems:**

| OS | Version | Notes |
|----|---------|-------|
| Debian | 13 (Trixie) or newer | ⚠️ Debian 12 (Bookworm) **not** supported — glibc too old |
| Ubuntu | 24.04 LTS or newer | ⚠️ Ubuntu 22.04 **not** supported |
| Arch Linux | rolling | always supported |

**Architectures:** `x86_64` (amd64), `aarch64` (arm64 — Raspberry Pi 3B+, 4, 5)

**Requirements:**

| Resource | Minimum | Notes |
|----------|---------|-------|
| Disk space | ~2 GB free | Node.js build output + bot binary |
| RAM | ~2 GB | Next.js build requires ~1.5 GB — add swap if less |

> **Raspberry Pi:** Must run a 64-bit OS. 32-bit Raspberry Pi OS is not supported.

> **Proxmox LXC:** If using an unprivileged container, add `lxc.apparmor.profile: unconfined` to `/etc/pve/lxc/<ID>.conf` on the host and restart the container before running the installer.

```bash
curl -fsSL https://raw.githubusercontent.com/bkd3sign/kleinanzeigen-bot-ui/main/install.sh -o /tmp/install.sh
sudo bash /tmp/install.sh
```

The installer guides you through all settings interactively. For non-interactive use, pass defaults via environment variables:

```bash
sudo INSTALL_DIR=/opt/kleinanzeigen-bot-ui \
     WORKSPACE_DIR=/opt/workspace \
     PORT=3737 \
     SERVICE_USER=root \
     BOT_RELEASE=latest \
     bash /tmp/install.sh --yes
```

**Environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `INSTALL_DIR` | `/opt/kleinanzeigen-bot-ui` | App source + Next.js build output |
| `WORKSPACE_DIR` | `/opt/workspace` | Config, ads, bot binary, user data |
| `PORT` | `3737` | Web interface port |
| `SERVICE_USER` | `root` | User the systemd service runs as (`root` or `botuser` or custom) |
| `BOT_RELEASE` | `latest` | Bot binary release tag (e.g. `2026+fd3bf64`) |

**Workspace layout after installation:**

```
$WORKSPACE_DIR/              (default: /opt/workspace)
├── bot/
│   └── kleinanzeigen-bot    Bot binary (auto-downloaded)
├── ads/                     Ad YAML files
├── users/                   Per-user workspaces (multi-user mode)
├── .temp/                   Temporary bot files
└── config.yaml              Bot config — auto-created from template, fill in via /setup
```

These additional files are created automatically by the app on first use:

```
$WORKSPACE_DIR/
├── users.yaml               App users, roles & JWT secret
├── schedules.yaml           Cron automation config
├── extensions.yaml          CDP script injection config
└── extensions/              Injected browser scripts
```

**Service management:**

```bash
systemctl status kleinanzeigen-bot-ui    # status
journalctl -u kleinanzeigen-bot-ui -f    # live logs
systemctl restart kleinanzeigen-bot-ui   # restart
```

---

### Setup (all options)

After starting via any option, open `http://<your-ip>:3737/setup` and complete:

1. **Credentials** — Kleinanzeigen.de email + password
2. **Contact** — Name, ZIP code, city
3. **AI** *(optional)* — OpenRouter API key for AI-powered ad generation

### Updates

| Method | How to update |
|--------|---------------|
| Docker (pre-built) | `docker compose pull && docker compose up -d` |
| Docker (from source) | Re-run `build.sh`, redeploy, `docker compose up -d --build` |
| Linux / install.sh | `sudo bash /opt/kleinanzeigen-bot-ui/install.sh --update` — skips system packages, pulls latest code, rebuilds, restarts (~3 min). Custom path: `sudo INSTALL_DIR=/your/path bash /your/path/install.sh --update` |
| Bot binary only | Admin → Bot-Update in the web UI |

## Security

Designed for **trusted environments** (home network, family use). Kleinanzeigen.de credentials are stored in plain text in `config.yaml` — only deploy for users you trust. JWT auth, rate limiting, and security headers (CSP, HSTS, X-Frame-Options) are built in. Use a reverse proxy with HTTPS if exposed beyond localhost.

---

## Upstream

Built on [kleinanzeigen-bot](https://github.com/Second-Hand-Friends/kleinanzeigen-bot) by Second-Hand-Friends.

## Tested On

- **Synology DS720+** — Docker via Container Manager
- **Ubuntu 24.04 LTS** (VM via UTM on macOS) — one-liner install (`install.sh`)
- **Raspberry Pi 3B+** (Debian 13 Trixie arm64) — one-liner install (`install.sh`)

## License

[AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html)
