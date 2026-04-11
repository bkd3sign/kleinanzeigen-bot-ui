# Changelog

All notable changes to this project are documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/).

---

## [2.40.1] - 2026-04-10

### Added
- Gate all AI features behind API key availability check
- Animations, collapsible sections, category dedup, and browser cleanup
- APR and updated_on columns with sortable table and mobile status dots
- Warm light theme with click-toggle theme switcher and strikethrough pricing
- Dependabot with auto-merge for patch and minor updates
- CI/CD pipelines: CI (lint, typecheck, test, build), Release (tag, Docker, GitHub Release), Publish-to-Public sync
- CDP script injection for browser extension workarounds

### Fixed
- Orange button in template modal and strikethrough pricing in duplicate picker
- Warm elevated background, GUI version in about modal, job limit to 10
- Robust browser profile cleanup to prevent stale state blocking startup
- Docker build in CI — copy entrypoint.sh to build context root
- ESLint errors, broken schema tests, and deprecated next lint migration

### Changed
- Improved workflow names, release notes styling, and README badges
- Public release audit — security, code quality, and documentation cleanup

---

## [2.38.0] - 2026-04-06

### Added
- AI usage stats, quick-save for ads, improved logs UI and button variants
- AI-sent message tracking with purple bubble and icon distinction
- Per-user KI messaging table — mode, browser, poll, sent count, pending
- Full KI status dashboard in filter — mode, browser, responder, poll, pending count
- KI-Messaging filter in job tracker with pending replies table
- Admin KI-Messaging overview table
- Performance, security, and anti-bot hardening
- AI mode badge (Auto/Review) next to Nachrichten in header
- Unread message count badge on header navigation link
- Smarter price negotiation based on price_type
- Availability schedule builder in settings integrated into LLM prompt
- Escalation for scheduling in auto+review mode, KI badge in conversation list
- Escalation banner in chat with auto-escalate scheduling messages
- Debug endpoint to inspect LLM prompt per conversation
- Ad description included in LLM prompt, prevent multi-reply on rapid messages
- AI responder status badge on messages page
- LLM auto-responder with price negotiation and settings UI
- Optimistic update for sent messages — appears instantly in chat
- Auto-start messaging on server boot, ad image in chat, colored bubbles
- Persistent browser session with auto-login for messaging
- Messaging page with Kleinanzeigen Gateway API integration

### Fixed
- Faster polling in review mode for quicker AI suggestions
- Ad expiration status, orphaned after publish, MFA auto-dismiss
- Multi-image upload, quick-save with images, Strict Mode compatibility
- Ad borders unified: 2px, expiring yellow, expired orange, inactive red
- Expiring calculation uses republication_interval instead of 60-day lifetime
- Inactive ads: red border-left and reduced opacity in table and card view
- Invite table mobile layout optimized for all screen sizes
- Content hash matching Python json.dumps separator style
- Browser only runs 24/7 when KI mode is on
- Unique CDP port per workspace for multi-user isolation
- Price negotiation rules hidden from buyer
- Shipping cost awareness in AI responses
- Find local ad by title fallback when ID changed after re-publish

### Changed
- Merge price-negotiation into prompts.ts — single source for all LLM prompts
- Single personality prompt field with hardcoded CORE rules

---

## [2.30.0] - 2026-04-01

### Added
- UI improvements: orphan badges, job pills, dashboard grid
- Rewrite download-all sync to preserve local counters and settings
- Shipping option mutual exclusivity and responsive dashboard grid
- Infinite scroll for conversations, trash icon for deleted ads

### Fixed
- iOS sequential camera uploads losing previous photos
- Pre-download snapshot instead of mtime for sync merge
- AI-invented special_attributes filtered to category-valid keys
- AI vision images compressed client-side for mobile multi-image upload
- Show VB/Gratis price type and action-required badge in conversation list

### Changed
- Remove image staging, fix config merge to preserve root settings
- Move Docker files to docker/, remove E2E tests and dead code

---

## [2.25.0] - 2026-03-28

### Added
- Deep schema compatibility check with auth loading screen
- Stage ad images to tmpfs for Docker NAS compatibility
- Responsive table scroll with default ad folder naming
- Chromium cleanup, process group kill, upstream check via fetch
- Price reduction validation warnings with min_price auto-clamp
- MFA/SMS challenge resolver with two-phase CDP automation
- Global MFA overlay modal — auto-appears on any page when SMS challenge detected
- Job duration display in output modal
- Redesigned AdCard for mobile — horizontal layout
- Enhanced dashboard — PriceChart animations, clickable navigation, date tooltips

### Fixed
- Bot binary moved to writable /workspace/bot/ for in-app self-update
- CONFIG_DEFAULTS fallback and unused dependencies removed
- BOT_CMD resolved to absolute path before bot update
- Chromium 146 headless mode compatibility
- Docker EACCES permissions for image uploads
- Dockerfile sha256 checksum removed

---

## [2.20.0] - 2026-03-25

### Added
- Responsive mobile/tablet overhaul — all pages usable on 375px+
- Fluid responsive CSS across all pages — no hard breakpoints
- Mandatory attribute filling — mini AI call for unfilled Merkmale
- Merkmale picker with Kleinanzeigen suggestions
- AI generation overhaul — vision prompt, structured templates, price/shipping defaults

### Fixed
- Mobile tables fit viewport without horizontal scroll
- Mobile hamburger menu overflow
- Admin tables aligned with same column widths on mobile
- Persist invite tokens so links remain accessible until expiry
- AI refinement integrates changes throughout description
- Category names from category_attributes.json
- API errors return correct HTTP status codes

---

## [2.16.0] - 2026-03-23

### Added
- PLZ-based location picker via Kleinanzeigen API
- Pre-release hardening with draft list in publish dialog
- Confirm dialog before publishing draft ads
- Auto-select cheapest shipping carrier when size is chosen
- Sortable columns and stagger animation for all tables
- Micro animations across the app
- Premium toast redesign with glow, glass, progress bar
- Build-docker.sh script for NAS deployment packaging

### Fixed
- Force-kill jobs with SIGTERM + SIGKILL fallback
- Select all carriers per size group and pre-fill cheapest shipping cost
- Sort synced between list view and card view
- Dropdown click propagation and toast centering

### Changed
- Extract shared DropdownMenu component, deduplicate CSS
- React.memo on dashboard components, JWT expiry 24h to 4h
- Tighten ad and AI input limits per Kleinanzeigen spec
- Remove dead code

---

## [2.10.0] - 2026-03-20

### Added
- Automation page with cron scheduler, job queue, and auth sync
- Bot update from GUI (admin only)
- Security hardening and performance optimizations
- Download sparkle animations, category name display, dashboard stats
- Bot commands modal with all CLI commands
- Multi-user auth with JWT, per-user workspaces, and admin panel
- AI vision image analysis and iterative ad refinement
- Setup wizard with enhanced empty states
- Settings page with optional auth, AI image upload
- Publish queue, contextual actions, dashboard analytics, templates

### Fixed
- API security hardened and project structure cleaned up
- Invite tokens stored for admin display
- Dashboard empty state aligned with ad-list action card style

---

## [2.0.0] - 2026-03-16

### Added
- Complete rebuild as Next.js 15 React app
- Replace legacy Python API + vanilla JS frontend
- Full CRUD for ad listings via YAML
- Grid and table views with persistent sort
- Bulk actions for publish, delete, update
- Image management with drag-drop upload and Sharp compression
- Category picker with 582 categories
- AI-powered ad generation (GPT-4.1-nano text, GPT-4.1-mini vision)
- Live bot logs via Server-Sent Events
- Job queue with single-concurrency FIFO
- JWT-based authentication with bcrypt
- Role system (Admin, User) with workspace isolation
- Template management
- Dashboard with statistics, charts, and calendar
- Auto price reduction with percentage and fixed strategies
- Dark/light theme support

---

## [1.0.0] - 2026-03-15

### Added
- Initial release of kleinanzeigen-bot-ui
- Enhanced AI ad generation with price hints and shipping detection
