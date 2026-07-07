import { spawn } from 'child_process';
import type { Writable } from 'stream';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { jobs, jobPids } from '@/lib/bot/jobs';
import { readMergedConfig } from '@/lib/yaml/config';
import { resolveBrowserMode, buildBrowserConfig, isAttachRun, type BrowserMode } from '@/lib/bot/browser-mode';
import { extractCDPPort, injectExtensionScripts } from '@/lib/bot/cdp-scripts';
import { hookCookiesAfterLogin } from '@/lib/stats/cookie-hook';
import { fetchAdStats } from '@/lib/stats/stats-fetcher';
import { syncOnlineIdsFromApi } from '@/lib/bot/hooks';
import { detectLoginOutcome } from '@/lib/bot/login-detection';
import { loginProfilePath } from '@/lib/bot/profile-path';
import { focusBotTab, listPageTargetIds } from '@/lib/browser/cdp';
import { startVncLogin, stopVncLogin, getVncSession } from '@/lib/vnc/lifecycle';
import { acquireBrowserLock, releaseBrowserLock } from '@/lib/bot/browser-lock';
import type { JobStatus } from '@/types/bot';

// Commands that actually launch a browser; non-browser commands must never
// trigger VNC start/stop or acquire the browser lock.
const BROWSER_COMMANDS = new Set(['publish', 'verify', 'delete', 'update', 'download', 'extend']);

export const BOT_DIR = process.env.BOT_DIR || process.cwd();

/** Rewrite merged.browser according to browser.mode (headless/auto/visible). */
export function applyBrowserMode(merged: Record<string, unknown>, workspace: string, attachPort?: number, nativeVisible?: boolean): void {
  const mode = resolveBrowserMode(merged);
  const browser = (merged.browser ?? {}) as Record<string, unknown>;
  const baseArguments = Array.isArray(browser.arguments) ? (browser.arguments as string[]) : [];
  const built = buildBrowserConfig({ mode, profilePath: loginProfilePath(workspace), attachPort, nativeVisible, baseArguments });
  merged.browser = { ...browser, ...built };
}

const BOT_CMD = process.env.BOT_CMD || path.join(BOT_DIR, 'bot', 'kleinanzeigen-bot');
const MAX_JOB_OUTPUT_SIZE = 5 * 1024 * 1024; // 5 MB max output per job
// Matches ANSI SGR color/style escape sequences (\x1b[..m) emitted when the bot runs in a PTY.
const ANSI_ESCAPE = /\x1b\[[0-9;]*m/g;

// Match Python logging format: YYYY-MM-DD HH:MM:SS,mmm (local time, comma separator)
function formatTs(): string {
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const p3 = (n: number) => String(n).padStart(3, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())},${p3(d.getMilliseconds())}`;
}

// Store stdin references for running jobs (for MFA code injection)
const globalStdins = globalThis as unknown as { __jobStdins?: Map<string, Writable> };
if (!globalStdins.__jobStdins) globalStdins.__jobStdins = new Map();
export const jobStdins: Map<string, Writable> = globalStdins.__jobStdins;

/**
 * Resume a job paused at a login/CAPTCHA wall (waiting_for_user): the bot is blocked on
 * stdin (ainput) inside its PTY. Write a newline to release it, then clear the wait state
 * so it counts as running again. Returns false if the job has no live stdin.
 */
export function resumePausedJob(jobId: string): boolean {
  const stdin = jobStdins.get(jobId);
  if (!stdin) return false;
  try {
    stdin.write('\n');
  } catch {
    return false;
  }
  const job = jobs.get(jobId);
  if (job && job.status === 'waiting_for_user') {
    job.waiting_for_user = false;
    job.status = 'running';
    job.last_output_at = new Date().toISOString();
  }
  return true;
}

/**
 * Determine job status from bot output and exit code.
 * Exported for unit testing.
 */
export function detectJobStatus(
  output: string,
  exitCode: number,
): 'completed' | 'completed_with_errors' | 'failed' {
  const resultLines = output.split('\n')
    .map(l => l.replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3} /, ''))
    .filter(l => /^\[(INFO|WARNUNG)\]/.test(l.trimStart()))
    .join('\n');
  const hasSuccesses = /ERFOLG|erfolgreich|successfully/i.test(resultLines);
  const hasFailures = /\bfehlgeschlagen\b|\bfailed\b|\bFEHLER\b|\bTimeoutError\b/i.test(resultLines) &&
    !/0 fehlgeschlagen|0 failed|keine\b.*\bfehler/i.test(resultLines);

  if (exitCode === 0 && !hasFailures) return 'completed';
  if (hasSuccesses && hasFailures) return 'completed_with_errors';
  if (exitCode === 0) return hasFailures ? 'completed_with_errors' : 'completed';
  return 'failed';
}

/**
 * True when bot output shows Chromium failed to start or connect. These are fatal —
 * the run never reached its work. The error is logged on [FEHLER] lines, which
 * detectJobStatus's INFO/WARNUNG summary filter deliberately ignores, so it must be
 * detected separately. Shared with the queue, which auto-retries this class of failure
 * (transient profile lock) after a clean profile wipe.
 */
export function hasBrowserConnectionError(output: string): boolean {
  return /Failed to connect to browser|ConnectionRefusedError|Fehler beim Starten des Browsers/i.test(output);
}

/**
 * True when bot output shows it has PAUSED at a login/CAPTCHA wall and is now blocking on
 * stdin (upstream pause_on_login_detection_failure → ainput). The bot runs with --lang=de, so
 * the ainput prompts are German (gettext-translated); only the "...paused for manual
 * inspection" banners stay English (literal in the source). Match both languages and every
 * pause path (Auth0 flow, captcha challenge, generic inconclusive) so the UI reliably flips to
 * waiting_for_user instead of leaving the job stuck "running" until the 10-min watchdog.
 */
export function isLoginPausePrompt(text: string): boolean {
  const t = text.toLowerCase();
  return (
    // English literal banners (language-independent — logged regardless of --lang)
    t.includes('paused for manual inspection') ||
    t.includes('security challenge is visible') ||
    // English ainput prompts (fallback when --lang is not de)
    t.includes('press enter when done') ||
    t.includes('press a key to continue') ||
    t.includes('press a key after solving') ||
    // German ainput prompts — the actual output under --lang=de
    t.includes('eingabetaste drücken') ||        // "EINGABETASTE drücken, wenn erledigt..."
    t.includes('eine taste drücken') ||          // "Eine Taste drücken, um fortzufahren / nachdem die Herausforderung..."
    t.includes('sicherheitsabfrage sichtbar')    // "# Falls eine Sicherheitsabfrage sichtbar ist, bitte lösen."
  );
}

/**
 * Final job status: login_required wins over generic failed.
 * Checks login outcome first; delegates to detectJobStatus otherwise.
 */
export function finalJobStatus(output: string, exitCode: number): JobStatus {
  // A browser that never started/connected did no work — always a failure, even when the
  // bot exits 0 and logs the cause only on [FEHLER] lines. Checked first: a dead browser
  // has no login outcome, and a 'completed' here would silently disable the queue's
  // profile-lock auto-retry (which only fires on status === 'failed').
  if (hasBrowserConnectionError(output)) return 'failed';
  if (detectLoginOutcome(output) === 'login_failed') return 'login_required';
  return detectJobStatus(output, exitCode);
}

/**
 * Run a bot CLI command as a child process, streaming output line by line.
 * In multi-user mode, writes a merged config (server + user) before running.
 * Output is capped at MAX_JOB_OUTPUT_SIZE to prevent memory exhaustion.
 */
export async function runBotCommand(
  command: string,
  jobId: string,
  workspace: string,
): Promise<void> {
  // create-config writes a fresh config; point it at .bot-config.yaml to protect root.
  // All other runs (single- AND multi-user): generate a derived config from readMergedConfig
  // so browser.mode (headless/attach) and the VNC profile lock are honored everywhere.
  // Hand-edits to config.yaml stay effective because readMergedConfig re-reads it each run.
  const baseCmd = command.split(/\s+/)[0];
  let configPath: string;
  let tookBotLock = false;
  // Tracked across the run so the close handler can suppress the login-recovery
  // status in strict headless mode (no VNC fallback there).
  let browserMode: BrowserMode = 'auto';
  // True when the bot runs inside the VNC browser (attach): it is spawned in a PTY so
  // stdin.isatty() is true and pause_on_login_detection_failure can take effect — the bot
  // then waits at a login/CAPTCHA wall for the user instead of aborting.
  let vncRun = false;
  // CDP port of the VNC browser the bot attaches to (vncRun); lets the close handler and the
  // tab-focus poller reach the shared browser. Hoisted out of the attach block below.
  let vncCdpPort: number | undefined;
  // AUTO-mode retry after a login_required job: force this run into the VNC browser so the
  // user can sign in live, even though the configured mode (auto) would normally be headless.
  const forceVisible = jobs.get(jobId)?.force_visible ?? false;
  // If setup throws AFTER the bot lock was acquired (e.g. fs.writeFileSync ENOSPC/EACCES or
  // applyBrowserMode), the lock would otherwise leak — the release only runs in the proc
  // close/error handlers wired inside the Promise below, which we never reach on an early
  // throw. A leaked 'bot' lock blocks both future bot runs AND VNC login for this workspace
  // until the server restarts, so release it here before rethrowing.
  try {
    if (baseCmd === 'create-config') {
      configPath = path.join(workspace, '.bot-config.yaml');
    } else {
      const merged = readMergedConfig(workspace);
      browserMode = resolveBrowserMode(merged);
      const isBrowserCmd = BROWSER_COMMANDS.has(baseCmd);
      let attachPort: number | undefined;
      let nativeVisible = false;
      if (isBrowserCmd) {
        if (isAttachRun(browserMode, forceVisible)) {
          // Headless server (Docker, no display): attach to the Xvnc/noVNC browser.
          // Lock stays held — the visible browser persists; a later headless run frees it via stopVncLogin.
          const session = await startVncLogin(workspace);
          attachPort = session.cdpPort;
        } else {
          // Headless/auto, OR visible on a desktop with a real display (native window).
          // Acquire the bot lock first — if 'vnc' holds it, stop vnc then re-acquire.
          if (!acquireBrowserLock(workspace, 'bot')) {
            await stopVncLogin(workspace); // releases 'vnc'
            acquireBrowserLock(workspace, 'bot'); // now free → take it
          }
          tookBotLock = true;
          nativeVisible = browserMode === 'visible'; // desktop visible → real non-headless window
        }
      }
      applyBrowserMode(merged, workspace, attachPort, nativeVisible);
      // VNC run = the bot attaches to the visible browser. Let it pause at a login wall
      // (instead of aborting) so the user can sign in / solve the CAPTCHA in the VNC view.
      vncRun = attachPort !== undefined;
      vncCdpPort = attachPort;
      if (vncRun) {
        // The pause toggle lives under diagnostics.* in the bot's config model — NOT at the top
        // level — and the model rejects it unless diagnostics.capture_on.login_detection is also
        // enabled. Setting it top-level (as before) was silently ignored, so the bot never paused
        // at the login wall: the visible-mode job just failed with login_required instead of
        // waiting for the user to sign in. Merge into any existing diagnostics block.
        const diag = (merged.diagnostics ?? {}) as Record<string, unknown>;
        const captureOn = (diag.capture_on ?? {}) as Record<string, unknown>;
        merged.diagnostics = {
          ...diag,
          capture_on: { ...captureOn, login_detection: true },
          pause_on_login_detection_failure: true,
        };
      }
      configPath = path.join(workspace, '.bot-config.yaml');
      fs.writeFileSync(configPath, yaml.dump(merged, { flowLevel: -1, sortKeys: false }), 'utf-8');
    }
  } catch (err) {
    if (tookBotLock) releaseBrowserLock(workspace, 'bot');
    throw err;
  }

  const logfileFlag = `--logfile=${path.join(BOT_DIR, 'kleinanzeigen-bot.log')}`;
  const langFlag = '--lang=de';
  const cmdArgs = command.split(/\s+/).filter(Boolean);
  const job = jobs.get(jobId);
  const lines: string[] = [];
  const finalConfigFlag = `--config=${configPath}`;

  const botArgs = [...cmdArgs, finalConfigFlag, logfileFlag, langFlag];

  // Snapshot the VNC browser's tabs BEFORE the bot attaches. nodriver opens its own tab to
  // work in but never brings it to the foreground, so the kiosk keeps showing the initial
  // KA_START_URL tab. The focus poller below uses this set to tell the bot's tab apart from
  // the initial one and surface it, so "Chrome öffnen" shows what the bot is doing.
  let vncInitialTabIds = new Set<string>();
  if (vncRun && vncCdpPort !== undefined) {
    try { vncInitialTabIds = new Set(await listPageTargetIds(vncCdpPort)); } catch { /* best effort */ }
  }

  return new Promise<void>((resolve) => {
    // VNC run: spawn the bot inside a PTY (python pty.spawn) so stdin.isatty() is true and
    // the bot's pause_on_login_detection_failure can wait for the user. argv is passed
    // directly (no shell quoting). Headless: plain pipe spawn (no pause, fast SIGKILL).
    const proc = vncRun
      ? spawn('python3', ['-c', 'import pty,sys; sys.exit(pty.spawn(sys.argv[1:]))', BOT_CMD, ...botArgs], {
          cwd: workspace,
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: true,
        })
      : spawn(BOT_CMD, botArgs, {
          cwd: workspace,
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: true, // Create new process group so we can kill bot + chromium together
        });

    // Store PID for cancellation
    if (proc.pid) jobPids.set(jobId, proc.pid);
    if (proc.stdin) jobStdins.set(jobId, proc.stdin);

    // Keep the bot's tab in front of the Xvnc kiosk while it runs, so the user watching via
    // "Chrome öffnen" sees the bot's page (login wall / publishing) instead of the stale
    // initial tab. No-op once the bot tab is already in front (see focusBotTab).
    const tabFocusTimer = (vncRun && vncCdpPort !== undefined)
      ? setInterval(() => { focusBotTab(vncCdpPort as number, vncInitialTabIds).catch(() => {}); }, 2500)
      : undefined;

    if (!job) {
      if (tabFocusTimer) clearInterval(tabFocusTimer);
      resolve();
      return;
    }

    let totalSize = 0;
    let truncated = false;
    let pendingLine = ''; // buffer for partial lines between chunks

    function processData(data: Buffer): void {
      // Strip ANSI color codes. In attach (vncRun) mode the bot runs inside a PTY, so it
      // detects a terminal and colorizes its output (\x1b[..m); without this the raw codes
      // (e.g. "[30m[INFO]") would show in the job log. Headless runs (plain pipe) aren't
      // colored, so this is a no-op there. Stripping also keeps the pause/MFA string matching
      // below robust against color codes interrupting a marker.
      const text = data.toString('utf-8').replace(ANSI_ESCAPE, '');

      if (!truncated) {
        // Split into complete lines; last entry is an incomplete line (no trailing \n yet)
        const combined = pendingLine + text;
        const parts = combined.split('\n');
        pendingLine = parts.pop() ?? '';

        // Prepend timestamp to each complete non-empty line; preserve blank lines as-is
        const stamped = parts.map(line => line ? `${formatTs()} ${line}` : '').join('\n')
          + (parts.length > 0 ? '\n' : '');

        totalSize += stamped.length;
        if (stamped) lines.push(stamped);

        if (totalSize > MAX_JOB_OUTPUT_SIZE) {
          truncated = true;
          lines.push('\n--- Output truncated (exceeded 5 MB limit) ---\n');
        }
      }

      // Detect Chrome CDP port and wire up post-login hooks (on raw text, before timestamp injection)
      const cdpPort = extractCDPPort(text);
      if (cdpPort && job) { job.cdp_port = cdpPort; }
      if (cdpPort) {
        const appendLine = (msg: string) => {
          if (!truncated) {
            lines.push(`${formatTs()} ${msg}`);
            if (job) job.output = lines.join('');
          }
        };
        injectExtensionScripts(cdpPort, appendLine).catch(() => { /* non-blocking */ });

        // Save session after login, fetch stats + sync online IDs (single API call).
        hookCookiesAfterLogin(cdpPort, workspace)
          .then(() => fetchAdStats(workspace))
          .then(ads => syncOnlineIdsFromApi(workspace, ads))
          .catch(() => { /* non-blocking */ });
      }

      // Detect a login/CAPTCHA pause: with pause_on_login_detection_failure + PTY the bot
      // prints a prompt and blocks on stdin instead of aborting. Surface it as
      // waiting_for_user so the UI can ask the user to act in the VNC browser and the
      // watchdog suspends. Resumed by writing to stdin (resume API).
      if (job && vncRun && !job.waiting_for_user && isLoginPausePrompt(text)) {
        job.waiting_for_user = true;
        job.status = 'waiting_for_user';
      }

      // Detect MFA/verification challenges in bot output (SMS or email)
      if (job && !job.mfa_required) {
        if (
          text.includes('mfa-sms-challenge') ||
          text.includes('mfa-email-challenge') ||
          text.includes('email-verification') ||
          text.includes('Device verification message detected') ||
          text.includes('Geräteverifizierung erkannt')
        ) {
          job.mfa_required = true;
        }
      }

      // Flush to job on every chunk for live output
      if (job) {
        job.output = lines.join('');
        job.last_output_at = new Date().toISOString();
      }
    }

    proc.stdout?.on('data', processData);
    proc.stderr?.on('data', processData);

    proc.on('close', (code) => {
      if (tabFocusTimer) clearInterval(tabFocusTimer);
      // Flush any incomplete line that had no trailing newline
      if (pendingLine && !truncated) {
        lines.push(`${formatTs()} ${pendingLine}\n`);
        pendingLine = '';
      }

      if (tookBotLock) releaseBrowserLock(workspace, 'bot');

      const pid = jobPids.get(jobId);
      jobPids.delete(jobId);
      jobStdins.delete(jobId);

      // A paused job (waiting_for_user) that reaches close ended without a resume — finalize
      // it like a running one so it never gets stuck in the wait state.
      if (job && (job.status === 'running' || job.status === 'waiting_for_user')) {
        job.waiting_for_user = false;
        job.output = lines.join('');
        job.exit_code = code ?? 1;
        job.finished_at = new Date().toISOString();
        // A fatal browser start/connect error means the run did no work — classify it as
        // failed FIRST, even if an MFA marker appeared earlier in the output. Otherwise a dead
        // browser is shown as 'mfa_required' (a prompt the user can't satisfy) and the queue's
        // profile-lock auto-retry (which only fires on 'failed') is silently skipped.
        let status = hasBrowserConnectionError(job.output)
          ? 'failed'
          : job.mfa_required
            ? 'mfa_required'
            : finalJobStatus(job.output, code ?? 1);
        // Strict headless mode offers no manual-login recovery (no VNC fallback),
        // so a login wall is surfaced as a plain failure instead of 'login_required'.
        if (status === 'login_required' && browserMode === 'headless') status = 'failed';
        job.status = status;
      }

      resolve();

      // Kills the bot's own process group. In headless/native-launch runs that is the bot
      // PLUS the Chromium it spawned — SIGTERM first so Chromium flushes session cookies
      // (restore_on_startup), then SIGKILL after a short window to avoid a lingering lock.
      // In ATTACH (vncRun) the bot only connects to the VNC Chromium (separate process group),
      // so this kills just the python PTY + bot — the warm VNC browser stays alive on purpose
      // (stopVncLogin tears it down later). MFA keeps the process alive deliberately —
      // killOrphanedChromium() handles that path.
      if (pid && !job?.mfa_required) {
        try { process.kill(-pid, 'SIGTERM'); } catch { /* already gone */ }
        setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ } }, 2500);
      }
    });

    proc.on('error', (err) => {
      if (tabFocusTimer) clearInterval(tabFocusTimer);
      if (tookBotLock) releaseBrowserLock(workspace, 'bot');
      if (job) {
        lines.push(`\nProcess error: ${err.message}\n`);
        job.output = lines.join('');
        job.exit_code = 1;
        job.finished_at = new Date().toISOString();
        job.status = 'failed';
      }
      resolve();
    });
  });
}
