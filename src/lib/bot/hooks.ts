import fs from 'fs';
import path from 'path';
import { jobs } from '@/lib/bot/jobs';
import type { Job } from '@/types/bot';
import { findAdFiles, readAd, writeAd } from '@/lib/yaml/ads';
import { readConfig } from '@/lib/yaml/config';
import { loadCatAttrsData, translateAttrValues } from '@/lib/ads/normalize-attributes';
import { computeContentHash } from '@/lib/ads/content-hash';
import {
  archiveAdFolder,
  resolveArchiveDir,
  resolveArchiveSubDir,
  unarchiveAdFolder,
  migrateArchiveIfNeeded,
  ARCHIVE_SUBDIR_ADS,
  ARCHIVE_SUBDIR_DOWNLOADS,
  type ArchiveOrigin,
} from './archive';
import type { KaManageAd } from '@/lib/ka/management-api';

const DOWNLOAD_ALL_JSON = '.last_download_all.json';

// Translate internal API values (e.g. "jack_jones") → display text ("Jack & Jones")
// in ad.special_attributes so the bot can re-publish without manual intervention.
// Mutates ad in-place; caller is responsible for writing the file.
function normalizeDownloadedAd(ad: Record<string, unknown>): boolean {
  const catData = loadCatAttrsData();
  const category = String(ad.category ?? '');
  if (!catData || !category || !ad.special_attributes) return false;

  const original = ad.special_attributes as Record<string, string>;
  const translated = translateAttrValues(original, category, catData);
  const changed = Object.keys(translated).some(k => translated[k] !== original[k]);
  if (!changed) return false;

  ad.special_attributes = translated;
  // Keep hash in sync so the ad doesn't appear "changed" after normalization
  if (ad.content_hash) ad.content_hash = computeContentHash(ad);
  return true;
}

export function resolveDownloadDir(workspace: string): string {
  try {
    const config = readConfig(workspace);
    const dir = (config as Record<string, unknown> & { download?: { dir?: string } })?.download?.dir;
    if (dir) return path.resolve(workspace, dir);
  } catch { /* fall through */ }
  return path.join(workspace, 'downloaded-ads');
}

export function resolveAdsDir(workspace: string): string {
  return path.join(workspace, 'ads');
}

/**
 * Merge no-ID drafts with matching downloaded files (matched by title+category).
 * "Draft" = any ad file outside downloaded-ads/ and archive with no id field.
 * "Download" = any ad file inside the config-defined downloaded-ads/ dir with a numeric id.
 * Uses config-resolved paths (download.dir) — no hardcoded directory names.
 * Works for both single-user and multi-user (each call scoped to its workspace).
 * Returns count of merged pairs. Fast no-op when no draft files exist.
 */
export function mergeDraftPairs(workspace: string): number {
  const downloadedDir = resolveDownloadDir(workspace);
  const archiveDir = resolveArchiveDir(workspace);
  const dlDirPrefix = downloadedDir + path.sep;
  const archiveDirPrefix = archiveDir + path.sep;

  // Single workspace scan (respects template exclusion and archive exclusion)
  const allFiles = findAdFiles(workspace, [archiveDir]);

  // Fast bail-out: no files outside download/archive dir → nothing to merge
  if (!allFiles.some(f => !f.startsWith(dlDirPrefix))) return 0;

  type Entry = { filePath: string; ad: Record<string, unknown>; key: string };
  const drafts: Entry[] = [];
  for (const filePath of allFiles) {
    // Draft = outside downloaded-ads/ (config-resolved) and outside archive
    if (filePath.startsWith(dlDirPrefix) || filePath.startsWith(archiveDirPrefix)) continue;
    let ad: Record<string, unknown>;
    try { ad = readAd(filePath); } catch { continue; }
    if (ad.id != null) continue;
    const title = ((ad.title as string) || '').trim().toLowerCase();
    const category = (ad.category as string) || '';
    if (!title || !category) continue;
    drafts.push({ filePath, ad, key: `${title}|${category}` });
  }
  if (drafts.length === 0) return 0;

  const downloads: Entry[] = [];
  for (const filePath of allFiles) {
    if (!filePath.startsWith(dlDirPrefix)) continue;
    let ad: Record<string, unknown>;
    try { ad = readAd(filePath); } catch { continue; }
    if (typeof ad.id !== 'number') continue;
    const title = ((ad.title as string) || '').trim().toLowerCase();
    const category = (ad.category as string) || '';
    if (!title || !category) continue;
    downloads.push({ filePath, ad, key: `${title}|${category}` });
  }

  const draftsByKey = new Map<string, Entry[]>();
  for (const d of drafts) {
    const arr = draftsByKey.get(d.key) ?? [];
    arr.push(d);
    draftsByKey.set(d.key, arr);
  }

  const downloadsByKey = new Map<string, Entry[]>();
  for (const d of downloads) {
    const arr = downloadsByKey.get(d.key) ?? [];
    arr.push(d);
    downloadsByKey.set(d.key, arr);
  }

  let merged = 0;
  for (const [, draftList] of draftsByKey) {
    if (draftList.length !== 1) continue;
    const dlList = downloadsByKey.get(draftList[0].key);
    if (!dlList || dlList.length !== 1) continue;

    const draft = draftList[0];
    const dl = dlList[0];

    for (const field of LOCAL_ONLY_FIELDS) {
      const val = draft.ad[field];
      if (val == null) continue;
      if (typeof val === 'number' && val === 0) continue;
      dl.ad[field] = val;
    }
    try {
      dl.ad.content_hash = computeContentHash(dl.ad);
      writeAd(dl.filePath, dl.ad);
      removeAdFile(draft.filePath);
      merged++;
    } catch { /* skip pair on I/O error */ }
  }

  return merged;
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

/** Delete ad YAML and remove the parent folder if no other YAML/JSON files remain. */
export function removeAdFile(filePath: string): void {
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
  const archiveDir = resolveArchiveDir(workspace);
  const entries: SnapshotEntry[] = [];

  for (const filePath of findAdFiles(workspace, [archiveDir])) {
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

  const archiveDir = resolveArchiveDir(workspace);
  for (const filePath of findAdFiles(workspace, [archiveDir])) {
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

export function archiveInactiveAdFolders(workspace: string): void {
  const downloadedDir = resolveDownloadDir(workspace);
  const adsDir = resolveAdsDir(workspace);
  const archiveDir = resolveArchiveDir(workspace);

  migrateArchiveIfNeeded(workspace, downloadedDir);

  for (const filePath of findAdFiles(downloadedDir, [archiveDir])) {
    const ad = readAd(filePath);
    if (ad.active !== false) continue;
    const folderPath = path.dirname(filePath);
    if (folderPath.startsWith(downloadedDir + path.sep)) {
      archiveAdFolder(folderPath, workspace, ARCHIVE_SUBDIR_DOWNLOADS);
    }
  }

  if (fs.existsSync(adsDir)) {
    for (const filePath of findAdFiles(adsDir, [archiveDir])) {
      const ad = readAd(filePath);
      if (ad.active !== false) continue;
      const folderPath = path.dirname(filePath);
      if (folderPath.startsWith(adsDir + path.sep)) {
        archiveAdFolder(folderPath, workspace, ARCHIVE_SUBDIR_ADS);
      }
    }
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
 * Persist online IDs from a pre-fetched KA management API response.
 * Called with the result of fetchAdStats so no extra API call is needed.
 * No-op if the ads list is empty (login failed or API unreachable).
 */
export function syncOnlineIdsFromApi(workspace: string, ads: KaManageAd[]): void {
  if (ads.length === 0) return;

  const result: DownloadAllResult = {
    timestamp: new Date().toISOString(),
    ids: ads.map(a => a.id),
  };
  const targetPath = path.join(workspace, DOWNLOAD_ALL_JSON);
  const tempPath = `${targetPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(result, null, 2), 'utf-8');
  fs.renameSync(tempPath, targetPath);

  const pausedIds = new Set(ads.filter(a => a.state === 'paused').map(a => a.id));
  const onlineIds = new Set(ads.map(a => a.id));

  const downloadedDir = resolveDownloadDir(workspace);
  const adsDir = resolveAdsDir(workspace);
  const archiveDir = resolveArchiveDir(workspace);

  for (const filePath of findAdFiles(workspace, [archiveDir])) {
    const ad = readAd(filePath);
    if (typeof ad.id !== 'number') continue;

    if (pausedIds.has(ad.id) && ad.active !== false) {
      ad.active = false;
      writeAd(filePath, ad);
    } else if (onlineIds.has(ad.id) && !pausedIds.has(ad.id) && ad.active === false) {
      ad.active = true;
      writeAd(filePath, ad);
    }
  }

  // Also check archive: ads that were archived because paused/inactive but are now online again
  if (fs.existsSync(archiveDir)) {
    for (const filePath of findAdFiles(archiveDir)) {
      const ad = readAd(filePath);
      if (typeof ad.id !== 'number') continue;
      if (!onlineIds.has(ad.id) || pausedIds.has(ad.id)) continue;
      // Ad is online and not paused — restore and unarchive
      if (ad.active === false) {
        ad.active = true;
        writeAd(filePath, ad);
      }
      unarchiveAdFolder(path.dirname(filePath), workspace, adsDir, downloadedDir);
    }
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
    const archiveDir = resolveArchiveDir(workspace);
    if (!fs.existsSync(downloadedDir)) return;

    // For partial downloads (new, specific IDs): merge new IDs into existing list
    if (!isDownloadAll) {
      const downloadedFiles = findAdFiles(downloadedDir, [archiveDir]);
      const existing = readLastDownloadAll(workspace);
      const existingIds = existing ? new Set(existing.ids) : new Set<number>();
      let added = 0;

      for (const filePath of downloadedFiles) {
        const ad = readAd(filePath);
        if (typeof ad.id !== 'number') continue;
        if (normalizeDownloadedAd(ad)) writeAd(filePath, ad);
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
    const downloadedFiles = findAdFiles(downloadedDir, [archiveDir]);
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

      // Normalize text-based attribute values (brand_s: jack_jones → "Jack & Jones")
      const attrNormalized = normalizeDownloadedAd(ad);

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

        const idChanged = snap.id !== (ad.id as number);
        if (restored.length > 0 || attrNormalized) {
          writeAd(filePath, ad);
          const prefix = idChanged ? `id: ${snap.id}→${ad.id}, ` : '';
          if (restored.length > 0) {
            log(job, `SYNC: ${adLabel(ad.title as string, ad.id as number)} — ${prefix}wiederhergestellt [${restored.join(', ')}]`);
          } else {
            log(job, `OK: ${adLabel(ad.title as string, ad.id as number)} — Attribute normalisiert`);
          }
        } else {
          log(job, `OK: ${adLabel(ad.title as string, ad.id as number)} — keine lokalen Felder zu restaurieren`);
        }

        // If the snapshot file is a different path AND the ID actually changed,
        // the ad was genuinely reposted — remove the old folder.
        // Guard: same ID but different path = pre-existing duplicate (handled by stale cleanup below).
        if (snap.filePath !== filePath && fs.existsSync(snap.filePath) && (idChanged || snap.inAds)) {
          deletedAdsPaths.add(snap.filePath);
          removeAdFile(snap.filePath);
          if (snap.inAds) {
            log(job, `LIVE: ads/-Entwurf gelöscht → ${path.basename(snap.filePath)}`);
          } else {
            log(job, `REPOST: Alter Ordner entfernt → ${path.basename(path.dirname(snap.filePath))} (ID ${snap.id} → ${ad.id as number})`);
          }
        }

        mergedCount++;
      } else {
        if (attrNormalized) writeAd(filePath, ad);
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
        const adFolder = path.dirname(entry.filePath);
        if (!adFolder.startsWith(archiveDir + path.sep)) {
          const origin: ArchiveOrigin = entry.inAds ? ARCHIVE_SUBDIR_ADS : ARCHIVE_SUBDIR_DOWNLOADS;
          archiveAdFolder(adFolder, workspace, origin);
        }
        log(job, `VERWAIST: ${adLabel(entry.title, entry.id)} — nicht mehr online, deaktiviert + archiviert`);
      }
    }

    // Remove archived copies for ads that came back online (fresh copy now in downloadedDir)
    for (const subdir of [ARCHIVE_SUBDIR_ADS, ARCHIVE_SUBDIR_DOWNLOADS]) {
      const subDirPath = resolveArchiveSubDir(workspace, subdir);
      if (!fs.existsSync(subDirPath)) continue;
      for (const dirEntry of fs.readdirSync(subDirPath, { withFileTypes: true })) {
        if (!dirEntry.isDirectory()) continue;
        const archivedFolder = path.join(subDirPath, dirEntry.name);
        try {
          const yamlFile = fs.readdirSync(archivedFolder)
            .find(f => f.startsWith('ad_') && /\.(ya?ml|json)$/i.test(f));
          if (!yamlFile) continue;
          const archivedAd = readAd(path.join(archivedFolder, yamlFile));
          if (typeof archivedAd.id === 'number' && onlineIds.has(archivedAd.id)) {
            fs.rmSync(archivedFolder, { recursive: true, force: true });
            log(job, `UNARCHIV: ${dirEntry.name} — wieder online, archivierte Kopie bereinigt`);
          }
        } catch { /* ignore */ }
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

    archiveInactiveAdFolders(workspace);
    cleanOrphanedImageDirs(downloadedDir, job);

    // Remove stale folders: folder name doesn't match YAML id while a correctly-named
    // folder for the same id exists. Catches duplicates that survived due to missing snapshots
    // (e.g. server restart mid-job) or in-place bot updates without folder rename.
    const byId = new Map<number, string[]>();
    for (const fp of findAdFiles(downloadedDir, [archiveDir])) {
      let stalead: Record<string, unknown>;
      try { stalead = readAd(fp); } catch { continue; }
      if (typeof stalead.id !== 'number') continue;
      const arr = byId.get(stalead.id) ?? [];
      arr.push(fp);
      byId.set(stalead.id, arr);
    }
    let staleCount = 0;
    for (const [staleId, paths] of byId) {
      if (paths.length <= 1) continue;
      const canonical = paths.find(p => path.basename(path.dirname(p)) === `ad_${staleId}`);
      if (!canonical) continue;
      for (const fp of paths) {
        if (fp === canonical) continue;
        removeAdFile(fp);
        staleCount++;
        log(job, `CLEANUP: Verwaister Ordner entfernt → ${path.basename(path.dirname(fp))} (Duplikat von id: ${staleId})`);
      }
    }

    log(job, `--- Ad-Sync abgeschlossen: ${downloadedFiles.length} online, ${mergedCount} gemergt, ${newCount} neu${staleCount > 0 ? `, ${staleCount} Duplikate bereinigt` : ''} ---`);
  } catch (err) {
    console.warn('[hooks] Failed to process download-all result:', err);
    const job = jobs.get(jobId);
    if (job) log(job, `FEHLER: Ad-Sync fehlgeschlagen — ${err}`);
  }
}
