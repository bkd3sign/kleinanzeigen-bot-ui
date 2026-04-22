import fs from 'fs';
import path from 'path';
import { jobs } from '@/lib/bot/jobs';
import type { Job } from '@/types/bot';
import { findAdFiles, readAd, writeAd } from '@/lib/yaml/ads';
import { readConfig } from '@/lib/yaml/config';

const DOWNLOAD_ALL_JSON = '.last_download_all.json';

export function resolveDownloadDir(workspace: string): string {
  try {
    const config = readConfig(workspace);
    const dir = (config as Record<string, unknown> & { download?: { dir?: string } })?.download?.dir;
    if (dir) return path.resolve(workspace, dir);
  } catch { /* fall through */ }
  return path.join(workspace, 'downloaded-ads');
}

// Local-only fields preserved from the snapshot (not stored on Kleinanzeigen)
const LOCAL_ONLY_FIELDS = [
  'repost_count',
  'price_reduction_count',
  'auto_price_reduction',
  'republication_interval',
  'description_prefix',
  'description_suffix',
  'shipping_type',
  'shipping_costs',
  'shipping_options',
  'sell_directly',
  'updated_on',
] as const;

interface DownloadAllResult {
  timestamp: string;
  ids: number[];
}

interface SnapshotEntry {
  filePath: string;
  id: number;
  title: string;
  category: string;
  fields: Record<string, unknown>;
  inAds: boolean; // true = ads/, false = downloaded-ads/
}

// In-memory snapshot store: jobId → { timestamp, entries }
const snapshots = new Map<string, { ts: number; entries: SnapshotEntry[] }>();

function log(job: Job, message: string): void {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  job.output += `\n[SYNC] ${timestamp} ${message}`;
}

export function readLastDownloadAll(workspace: string): DownloadAllResult | null {
  const filePath = path.join(workspace, DOWNLOAD_ALL_JSON);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as DownloadAllResult;
  } catch {
    return null;
  }
}

function adLabel(title: string, id: number): string {
  return `"${title || '(Ohne Titel)'}" (ID ${id})`;
}

function deactivateAd(filePath: string, ad: Record<string, unknown>): void {
  if (ad.active === false) return;
  ad.active = false;
  writeAd(filePath, ad);
}

function removeAdFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
    const dir = path.dirname(filePath);
    // If no other YAML files remain, clean up the entire directory (images etc.)
    const remaining = fs.readdirSync(dir);
    const hasOtherYaml = remaining.some(f => /\.(ya?ml|json)$/i.test(f));
    if (!hasOtherYaml) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch { /* already gone */ }
}

/**
 * Save a snapshot of all local-only fields BEFORE a download-all runs.
 * Called from the queue before the bot process starts.
 */
export function onJobStarting(jobId: string, command: string, workspace: string): void {
  // Cleanup stale snapshots (older than 1 hour)
  for (const [id, snap] of snapshots) {
    if (Date.now() - snap.ts > 3600000) snapshots.delete(id);
  }

  if (!command.includes('download') || !command.includes('--ads=all')) return;

  const downloadedDir = resolveDownloadDir(workspace);
  const entries: SnapshotEntry[] = [];

  for (const filePath of findAdFiles(workspace)) {
    const ad = readAd(filePath);
    if (typeof ad.id !== 'number') continue;

    const fields: Record<string, unknown> = {};
    for (const field of LOCAL_ONLY_FIELDS) {
      if (ad[field] !== undefined && ad[field] !== null) {
        fields[field] = ad[field];
      }
    }

    entries.push({
      filePath,
      id: ad.id,
      title: ((ad.title as string) || '').trim().toLowerCase(),
      category: (ad.category as string) || '',
      fields,
      inAds: !filePath.startsWith(downloadedDir + path.sep),
    });
  }

  snapshots.set(jobId, { ts: Date.now(), entries });
}

/**
 * Refresh the online ID list by scanning all ad YAML files for IDs.
 * Called after publish/delete/extend to keep .last_download_all.json in sync
 * with potentially changed ad IDs (publish deletes+recreates → new ID).
 */
function refreshOnlineIds(workspace: string, job: Job): void {
  const existing = readLastDownloadAll(workspace);
  const existingIds = existing ? new Set(existing.ids) : new Set<number>();
  const currentIds = new Set<number>();

  for (const filePath of findAdFiles(workspace)) {
    const ad = readAd(filePath);
    if (typeof ad.id === 'number') {
      currentIds.add(ad.id);
    }
  }

  // Merge: add new IDs, remove IDs that no longer exist in any YAML
  let changed = false;
  for (const id of currentIds) {
    if (!existingIds.has(id)) {
      existingIds.add(id);
      changed = true;
    }
  }

  if (changed) {
    const result: DownloadAllResult = {
      timestamp: new Date().toISOString(),
      ids: [...existingIds],
    };
    const targetPath = path.join(workspace, DOWNLOAD_ALL_JSON);
    const tempPath = `${targetPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(result, null, 2), 'utf-8');
    fs.renameSync(tempPath, targetPath);
    log(job, `Online-IDs aktualisiert (${currentIds.size} aus YAMLs, gesamt: ${existingIds.size})`);
  }
}

function cleanOrphanedImageDirs(downloadedDir: string, job: Job): void {
  if (!fs.existsSync(downloadedDir)) return;
  let removed = 0;
  for (const entry of fs.readdirSync(downloadedDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(downloadedDir, entry.name);
    const hasYaml = fs.readdirSync(dirPath).some(f => /\.(ya?ml|json)$/i.test(f));
    if (!hasYaml) {
      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
        removed++;
        log(job, `CLEANUP: Verwaister Bildordner entfernt → ${entry.name}`);
      } catch { /* ignore */ }
    }
  }
  if (removed > 0) {
    log(job, `CLEANUP: ${removed} verwaiste Bildordner in ${path.basename(downloadedDir)}/ entfernt`);
  }
}

/**
 * Post-completion hook for download commands.
 *
 * For `download --ads=all`: Full sync — snapshot restore, orphan detection,
 * and complete online ID list replacement.
 *
 * For other download modes (new, specific IDs): Merge newly downloaded IDs
 * into the existing online ID list so they don't appear as orphaned.
 */
export function onJobCompleted(jobId: string, command: string, workspace: string): void {
  try {
    // After publish/delete/extend: refresh online ID list from YAML files
    // The bot may assign new IDs (publish deletes+recreates ads) that aren't in .last_download_all.json yet
    if (command.includes('publish') || command.includes('delete') || command.includes('extend')) {
      const job = jobs.get(jobId);
      if (!job || (job.exit_code !== 0 && job.exit_code !== null)) return;
      refreshOnlineIds(workspace, job);
    }

    if (!command.includes('download')) return;

    const isDownloadAll = command.includes('--ads=all');

    const job = jobs.get(jobId);
    if (!job || (job.exit_code !== 0 && job.exit_code !== null)) return;

    const downloadedDir = resolveDownloadDir(workspace);
    if (!fs.existsSync(downloadedDir)) return;

    // For partial downloads (new, specific IDs): merge new IDs into existing list
    if (!isDownloadAll) {
      const downloadedFiles = findAdFiles(downloadedDir);
      const existing = readLastDownloadAll(workspace);
      const existingIds = existing ? new Set(existing.ids) : new Set<number>();
      let added = 0;

      for (const filePath of downloadedFiles) {
        const ad = readAd(filePath);
        if (typeof ad.id !== 'number') continue;
        if (!existingIds.has(ad.id)) {
          existingIds.add(ad.id);
          added++;
        }
      }

      if (added > 0) {
        const result: DownloadAllResult = {
          timestamp: new Date().toISOString(),
          ids: [...existingIds],
        };
        const targetPath = path.join(workspace, DOWNLOAD_ALL_JSON);
        const tempPath = `${targetPath}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(result, null, 2), 'utf-8');
        fs.renameSync(tempPath, targetPath);
        log(job, `${added} neue ID(s) zur Online-Liste hinzugefügt (gesamt: ${existingIds.size})`);
      }

      return;
    }

    // --- Full download --ads=all: snapshot restore + orphan detection ---

    const snapshotData = snapshots.get(jobId);
    const snapshot = snapshotData?.entries;
    snapshots.delete(jobId);

    log(job, '--- Ad-Sync gestartet ---');

    // Build snapshot lookup maps
    const snapById = new Map<number, SnapshotEntry>();
    const snapByTitle = new Map<string, SnapshotEntry>();
    if (snapshot) {
      for (const entry of snapshot) {
        snapById.set(entry.id, entry);
        if (entry.title && entry.category) {
          snapByTitle.set(`${entry.title}::${entry.category}`, entry);
        }
      }
      log(job, `Snapshot: ${snapshot.length} Anzeigen vor Download gesichert`);
    } else {
      log(job, 'Kein Snapshot vorhanden — erster Download oder Server-Neustart');
    }

    // Collect all current downloaded files
    const downloadedFiles = findAdFiles(downloadedDir);
    const onlineIds = new Set<number>();
    let mergedCount = 0;
    let newCount = 0;
    const deletedAdsPaths = new Set<string>();

    for (const filePath of downloadedFiles) {
      const ad = readAd(filePath);
      if (typeof ad.id !== 'number') continue;

      onlineIds.add(ad.id);
      const title = ((ad.title as string) || '').trim().toLowerCase();
      const category = (ad.category as string) || '';
      const titleKey = title && category ? `${title}::${category}` : null;

      // Find matching snapshot entry
      let snap = snapById.get(ad.id);
      if (!snap && titleKey) {
        snap = snapByTitle.get(titleKey);
      }

      if (snap) {
        // Restore local-only fields from snapshot
        const restored: string[] = [];
        for (const field of LOCAL_ONLY_FIELDS) {
          const snapVal = snap.fields[field];
          if (snapVal !== undefined && snapVal !== null) {
            // For counters: only restore if > 0
            if (typeof snapVal === 'number' && snapVal === 0) continue;
            ad[field] = snapVal;
            restored.push(typeof snapVal === 'number' ? `${field}=${snapVal}` : field);
          }
        }

        if (restored.length > 0) {
          writeAd(filePath, ad);
          const idChanged = snap.id !== (ad.id as number);
          const prefix = idChanged ? `id: ${snap.id}→${ad.id}, ` : '';
          log(job, `SYNC: ${adLabel(ad.title as string, ad.id as number)} — ${prefix}wiederhergestellt [${restored.join(', ')}]`);
        } else {
          log(job, `OK: ${adLabel(ad.title as string, ad.id as number)} — keine lokalen Felder zu restaurieren`);
        }

        // If snapshot was from ads/, delete that file (now live in downloaded-ads/)
        if (snap.inAds && fs.existsSync(snap.filePath)) {
          deletedAdsPaths.add(snap.filePath);
          removeAdFile(snap.filePath);
          log(job, `LIVE: ads/-Entwurf gelöscht → ${path.basename(snap.filePath)}`);
        }

        mergedCount++;
      } else {
        log(job, `NEU: ${adLabel(ad.title as string, ad.id as number)} — in downloaded-ads/ verfügbar`);
        newCount++;
      }
    }

    // Deactivate snapshot entries that are no longer online
    if (snapshot) {
      for (const entry of snapshot) {
        if (onlineIds.has(entry.id)) continue;
        if (deletedAdsPaths.has(entry.filePath)) continue;
        if (!fs.existsSync(entry.filePath)) continue;

        const ad = readAd(entry.filePath);
        deactivateAd(entry.filePath, ad);
        log(job, `VERWAIST: ${adLabel(entry.title, entry.id)} — nicht mehr online, deaktiviert`);
      }
    }

    // Persist online ID set
    const result: DownloadAllResult = {
      timestamp: new Date().toISOString(),
      ids: [...onlineIds],
    };
    const targetPath = path.join(workspace, DOWNLOAD_ALL_JSON);
    const tempPath = `${targetPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(result, null, 2), 'utf-8');
    fs.renameSync(tempPath, targetPath);

    cleanOrphanedImageDirs(downloadedDir, job);

    log(job, `--- Ad-Sync abgeschlossen: ${downloadedFiles.length} online, ${mergedCount} gemergt, ${newCount} neu ---`);
  } catch (err) {
    console.warn('[hooks] Failed to process download-all result:', err);
    const job = jobs.get(jobId);
    if (job) log(job, `FEHLER: Ad-Sync fehlgeschlagen — ${err}`);
  }
}
