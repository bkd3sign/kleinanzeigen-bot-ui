import { spawn } from 'child_process';
import type { Writable } from 'stream';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { jobs, jobPids } from '@/lib/bot/jobs';
import { readMergedConfig } from '@/lib/yaml/config';
import { extractCDPPort, injectExtensionScripts } from '@/lib/bot/cdp-scripts';
import { hookCookiesAfterLogin } from '@/lib/stats/cookie-hook';
import { fetchAdStats } from '@/lib/stats/stats-fetcher';
import { syncOnlineIdsFromApi } from '@/lib/bot/hooks';

export const BOT_DIR = process.env.BOT_DIR || process.cwd();
const BOT_CMD = process.env.BOT_CMD || path.join(BOT_DIR, 'bot', 'kleinanzeigen-bot');
const MAX_JOB_OUTPUT_SIZE = 5 * 1024 * 1024; // 5 MB max output per job

// Store stdin references for running jobs (for MFA code injection)
const globalStdins = globalThis as unknown as { __jobStdins?: Map<string, Writable> };
if (!globalStdins.__jobStdins) globalStdins.__jobStdins = new Map();
export const jobStdins: Map<string, Writable> = globalStdins.__jobStdins;

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
 * Run a bot CLI command as a child process, streaming output line by line.
 * In multi-user mode, writes a merged config (server + user) before running.
 * Output is capped at MAX_JOB_OUTPUT_SIZE to prevent memory exhaustion.
 */
export async function runBotCommand(
  command: string,
  jobId: string,
  workspace: string,
): Promise<void> {
  // Single-user: bot reads root config.yaml directly (source of truth).
  // Multi-user: write a temporary merged config (root server settings + user login/ad_defaults).
  // create-config is a special case: always use .bot-config.yaml to protect root.
  const baseCmd = command.split(/\s+/)[0];
  let configPath: string;
  if (workspace !== BOT_DIR || baseCmd === 'create-config') {
    const merged = readMergedConfig(workspace);
    configPath = path.join(workspace, '.bot-config.yaml');
    fs.writeFileSync(configPath, yaml.dump(merged, { flowLevel: -1, sortKeys: false }), 'utf-8');
  } else {
    configPath = path.join(workspace, 'config.yaml');
  }

  const logfileFlag = `--logfile=${path.join(BOT_DIR, 'kleinanzeigen-bot.log')}`;
  const langFlag = '--lang=de';
  const cmdArgs = command.split(/\s+/).filter(Boolean);
  const job = jobs.get(jobId);
  const lines: string[] = [];
  const finalConfigFlag = `--config=${configPath}`;

  return new Promise<void>((resolve) => {
    const proc = spawn(BOT_CMD, [...cmdArgs, finalConfigFlag, logfileFlag, langFlag], {
      cwd: workspace,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true, // Create new process group so we can kill bot + chromium together
    });

    // Store PID for cancellation
    if (proc.pid) jobPids.set(jobId, proc.pid);
    if (proc.stdin) jobStdins.set(jobId, proc.stdin);

    if (!job) {
      resolve();
      return;
    }

    let totalSize = 0;
    let truncated = false;
    let pendingLine = ''; // buffer for partial lines between chunks

    // Match Python logging format: YYYY-MM-DD HH:MM:SS,mmm (local time, comma separator)
    const formatTs = (): string => {
      const d = new Date();
      const p2 = (n: number) => String(n).padStart(2, '0');
      const p3 = (n: number) => String(n).padStart(3, '0');
      return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())},${p3(d.getMilliseconds())}`;
    };

    function processData(data: Buffer): void {
      const text = data.toString('utf-8');

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
      // Flush any incomplete line that had no trailing newline
      if (pendingLine && !truncated) {
        lines.push(`${formatTs()} ${pendingLine}\n`);
        pendingLine = '';
      }

      const pid = jobPids.get(jobId);
      jobPids.delete(jobId);
      jobStdins.delete(jobId);

      if (job && job.status === 'running') {
        job.output = lines.join('');
        job.exit_code = code ?? 1;
        job.finished_at = new Date().toISOString();
        job.status = job.mfa_required ? 'mfa_required' : detectJobStatus(job.output, code ?? 1);
      }

      resolve();

      // Kill Chrome process group immediately (SIGKILL: no delay, no ignore).
      // SIGTERM is too slow — Chromium can linger, recreate SingletonLock, and block retries.
      // MFA keeps Chrome alive deliberately — killOrphanedChromium() handles that path.
      if (pid && !job?.mfa_required) {
        try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
      }
    });

    proc.on('error', (err) => {
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
