import fs from 'fs';
import path from 'path';

export const ARCHIVE_SUBDIR_ADS = 'ads' as const;
export const ARCHIVE_SUBDIR_DOWNLOADS = 'downloads' as const;
export type ArchiveOrigin = typeof ARCHIVE_SUBDIR_ADS | typeof ARCHIVE_SUBDIR_DOWNLOADS;

export function resolveArchiveDir(workspace: string): string {
  return path.join(workspace, 'archive');
}

export function resolveArchiveSubDir(workspace: string, origin: ArchiveOrigin): string {
  return path.join(resolveArchiveDir(workspace), origin);
}

// Move an ad folder into workspace/archive/<origin>/
export function archiveAdFolder(adFolderPath: string, workspace: string, origin: ArchiveOrigin): void {
  if (!fs.existsSync(adFolderPath)) return;
  const archiveSubDir = resolveArchiveSubDir(workspace, origin);
  const dest = path.join(archiveSubDir, path.basename(adFolderPath));
  if (fs.existsSync(dest)) return;
  fs.mkdirSync(archiveSubDir, { recursive: true });
  fs.renameSync(adFolderPath, dest);
}

// Move an archived folder back to its origin directory.
// Determines destination from which subdir (ads/ or downloads/) the folder lives in.
export function unarchiveAdFolder(
  archivedFolderPath: string,
  workspace: string,
  adsDir: string,
  downloadDir: string,
): void {
  if (!fs.existsSync(archivedFolderPath)) return;
  const adsArchiveDir = resolveArchiveSubDir(workspace, ARCHIVE_SUBDIR_ADS);
  const destDir = archivedFolderPath.startsWith(adsArchiveDir + path.sep) ? adsDir : downloadDir;
  const dest = path.join(destDir, path.basename(archivedFolderPath));
  if (fs.existsSync(dest)) return;
  fs.mkdirSync(destDir, { recursive: true });
  fs.renameSync(archivedFolderPath, dest);
}

// Lazy migration: move workspace/downloaded-ads/archive/ contents to workspace/archive/downloads/.
// Idempotent — runs on every call but is a no-op once old archive is empty/gone.
// Removes the old archive folder entirely once all ad directories are migrated,
// even if stray non-directory files (e.g. .DS_Store) remain.
export function migrateArchiveIfNeeded(workspace: string, downloadDir: string): void {
  const oldArchiveDir = path.join(downloadDir, 'archive');
  if (!fs.existsSync(oldArchiveDir)) return;

  const dirEntries = fs.readdirSync(oldArchiveDir, { withFileTypes: true }).filter(e => e.isDirectory());
  if (dirEntries.length > 0) {
    const newDownloadsSubDir = resolveArchiveSubDir(workspace, ARCHIVE_SUBDIR_DOWNLOADS);
    fs.mkdirSync(newDownloadsSubDir, { recursive: true });
    for (const entry of dirEntries) {
      const src = path.join(oldArchiveDir, entry.name);
      const dest = path.join(newDownloadsSubDir, entry.name);
      if (!fs.existsSync(dest)) fs.renameSync(src, dest);
    }
  }

  // If no ad directories remain, remove the old archive folder along with any
  // stray non-directory files (.DS_Store, etc.).
  const remainingDirs = fs.readdirSync(oldArchiveDir, { withFileTypes: true }).filter(e => e.isDirectory());
  if (remainingDirs.length === 0) {
    try { fs.rmSync(oldArchiveDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
