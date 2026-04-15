import { spawn } from 'child_process';
import type { Writable } from 'stream';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { jobs, jobPids } from '@/lib/bot/jobs';
import { readMergedConfig } from '@/lib/yaml/config';
import { extractCDPPort, injectExtensionScripts } from '@/lib/bot/cdp-scripts';
import { prepareCleanBrowserState } from '@/lib/bot/browser-cleanup';

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

  // Kill orphaned chromium + clean stale profile files for this workspace
  prepareCleanBrowserState(workspace);

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

    function processData(data: Buffer): void {
      const text = data.toString('utf-8');
      totalSize += text.length;

      if (!truncated) {
        lines.push(text);
        if (totalSize > MAX_JOB_OUTPUT_SIZE) {
          truncated = true;
          lines.push('\n--- Output truncated (exceeded 5 MB limit) ---\n');
        }
      }

      // Detect Chrome CDP port and inject extension scripts
      const cdpPort = extractCDPPort(text);
      if (cdpPort && job) { job.cdp_port = cdpPort; }
      if (cdpPort) {
        const appendLine = (msg: string) => {
          if (!truncated) {
            lines.push(msg);
            if (job) job.output = lines.join('');
          }
        };
        injectExtensionScripts(cdpPort, appendLine).catch(() => { /* non-blocking */ });
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
      // Clean up zombie Chrome processes from the detached process group
      const pid = jobPids.get(jobId);
      jobPids.delete(jobId);
      jobStdins.delete(jobId);
      if (pid) {
        try { process.kill(-pid, 'SIGTERM'); } catch { /* group already gone */ }
      }

      if (job && job.status === 'running') {
        job.output = lines.join('');
        job.exit_code = code ?? 1;
        job.finished_at = new Date().toISOString();
        if (job.mfa_required) {
          job.status = 'mfa_required';
        } else {
          job.status = detectJobStatus(job.output, code ?? 1);
        }
      }
      resolve();
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
