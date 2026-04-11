import { handleApiError } from '@/lib/api/error-handler';
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/middleware';
import { jobs, cleanupJobs } from '@/lib/bot/jobs';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import cryptoModule from 'crypto';
import type { Job } from '@/types/bot';

const BOT_DIR = process.env.BOT_DIR || process.cwd();
const BOT_CMD = process.env.BOT_CMD || path.join(BOT_DIR, 'bot', 'kleinanzeigen-bot');

const RELEASE_BASE = 'https://github.com/Second-Hand-Friends/kleinanzeigen-bot/releases/download';

/**
 * Detect the platform suffix for the bot binary download.
 */
function getPlatformSuffix(): string {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'linux') {
    return `linux-${arch === 'arm64' ? 'arm64' : 'amd64'}`;
  }
  if (platform === 'darwin') {
    return `darwin-${arch === 'arm64' ? 'arm64' : 'x86_64'}`;
  }
  throw new Error(`Unsupported platform: ${platform}/${arch}`);
}

/**
 * Run the bot update as a tracked job with live output.
 */
async function runBotUpdate(jobId: string, channel: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  const log = (line: string) => {
    job.output += line + '\n';
  };

  try {
    const suffix = getPlatformSuffix();
    const binaryUrl = `${RELEASE_BASE}/${channel}/kleinanzeigen-bot-${suffix}`;
    const checksumUrl = `${binaryUrl}.sha256`;

    // Step 1: Current version
    let oldVersion = 'nicht installiert';
    try {
      oldVersion = execFileSync(BOT_CMD, ['version'], { timeout: 10000 }).toString().trim();
    } catch {
      // Bot might not exist yet
    }
    log(`Aktuelle Version: ${oldVersion}`);
    log(`Channel: ${channel}`);
    log(`Plattform: ${suffix}`);
    log('');

    // Step 2: Download binary
    log(`Binary herunterladen…`);
    log(`  URL: ${binaryUrl}`);
    const binaryResponse = await fetch(binaryUrl, { redirect: 'follow' });
    if (!binaryResponse.ok) {
      log(`  FEHLER: HTTP ${binaryResponse.status} ${binaryResponse.statusText}`);
      job.status = 'failed';
      job.exit_code = 1;
      job.finished_at = new Date().toISOString();
      return;
    }
    const binaryBuffer = Buffer.from(await binaryResponse.arrayBuffer());
    const sizeMB = (binaryBuffer.length / 1024 / 1024).toFixed(1);
    log(`  Heruntergeladen: ${sizeMB} MB`);

    // Step 3: Checksum verification
    log('');
    log('SHA256-Prüfsumme verifizieren…');
    const checksumResponse = await fetch(checksumUrl, { redirect: 'follow' });
    const actualHash = cryptoModule.createHash('sha256').update(binaryBuffer).digest('hex');

    if (checksumResponse.ok) {
      const expectedHash = (await checksumResponse.text()).trim().split(/\s+/)[0];
      if (expectedHash !== actualHash) {
        log(`  FEHLER: Prüfsumme ungültig!`);
        log(`  Erwartet: ${expectedHash}`);
        log(`  Erhalten: ${actualHash}`);
        job.status = 'failed';
        job.exit_code = 1;
        job.finished_at = new Date().toISOString();
        return;
      }
      log(`  SHA256: ${actualHash.slice(0, 16)}… OK`);
    } else {
      log(`  Prüfsumme nicht verfügbar (HTTP ${checksumResponse.status}) — übersprungen`);
      log(`  SHA256: ${actualHash.slice(0, 16)}…`);
    }

    // Step 4: Write and verify new binary
    log('');
    log('Neue Binary installieren…');

    const botPath = BOT_CMD;
    const tempPath = `${botPath}.update-tmp`;

    const botDir = path.dirname(botPath);
    if (!fs.existsSync(botDir)) {
      fs.mkdirSync(botDir, { recursive: true });
      log(`  Verzeichnis erstellt: ${botDir}`);
    }

    fs.writeFileSync(tempPath, binaryBuffer);
    fs.chmodSync(tempPath, 0o755);
    log(`  Temporäre Datei geschrieben: ${tempPath}`);

    // Verify the new binary works
    log('  Neue Binary testen…');
    let newVersion: string;
    try {
      newVersion = execFileSync(tempPath, ['version'], { timeout: 10000 }).toString().trim();
      log(`  Neue Version: ${newVersion} — OK`);
    } catch (err) {
      fs.unlinkSync(tempPath);
      log(`  FEHLER: Neue Binary ist nicht ausführbar!`);
      log(`  ${err instanceof Error ? err.message : String(err)}`);
      log('  Update abgebrochen. Alte Version bleibt erhalten.');
      job.status = 'failed';
      job.exit_code = 1;
      job.finished_at = new Date().toISOString();
      return;
    }

    // Step 5: Atomic replace
    fs.renameSync(tempPath, botPath);
    log(`  Binary ersetzt: ${botPath}`);

    // Step 5b: Clean browser profile — new bot version may need fresh profile
    const browserProfileDir = path.join(BOT_DIR, '.temp', 'browser-profile');
    try {
      fs.rmSync(browserProfileDir, { recursive: true, force: true });
      log('  Browser-Profil bereinigt (wird beim nächsten Start neu erstellt)');
    } catch { /* fine */ }

    // Step 6: Final verification
    log('');
    let verifiedVersion: string;
    try {
      verifiedVersion = execFileSync(botPath, ['version'], { timeout: 10000 }).toString().trim();
    } catch {
      verifiedVersion = newVersion;
    }

    log('############################################');
    log(`Bot aktualisiert: ${oldVersion} → ${verifiedVersion}`);
    log('############################################');

    job.status = 'completed';
    job.exit_code = 0;
    job.finished_at = new Date().toISOString();
  } catch (err) {
    log('');
    log(`FEHLER: ${err instanceof Error ? err.message : String(err)}`);
    job.status = 'failed';
    job.exit_code = 1;
    job.finished_at = new Date().toISOString();
  }
}

/**
 * POST /api/bot/update-bot
 * Downloads the latest bot binary, verifies SHA256, and replaces the current one.
 * Creates a tracked job so the update appears in job history with full output.
 * Admin-only.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser(request);
    if (!user || user.role !== 'admin') {
      return NextResponse.json({ detail: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const channel = (body.channel as string) || 'latest';

    if (!['latest', 'preview'].includes(channel)) {
      return NextResponse.json({ detail: 'Invalid channel. Use "latest" or "preview".' }, { status: 400 });
    }

    cleanupJobs();

    const now = new Date();
    const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 15);
    const hex = cryptoModule.randomBytes(3).toString('hex');
    const jobId = `job_${ts}_${hex}`;

    const job: Job = {
      job_id: jobId,
      command: `update-bot (${channel})`,
      status: 'running',
      started_at: now.toISOString(),
      output: '',
      user_id: user.id,
      workspace: user.workspace,
    };

    jobs.set(jobId, job);

    // Fire-and-forget: run update in background
    runBotUpdate(jobId, channel).catch(() => { /* error handled in job status */ });

    return NextResponse.json(job);
  } catch (error) {
    return handleApiError(error);
  }
}
