import fs from 'fs';
import path from 'path';

export function resolveArchiveDir(downloadDir: string): string {
  return path.join(downloadDir, 'archive');
}

// Move an ad folder (by its full path) into the archive/ subdir of downloadDir
export function archiveAdFolder(adFolderPath: string, downloadDir: string): void {
  if (!fs.existsSync(adFolderPath)) return;
  const archiveDir = resolveArchiveDir(downloadDir);
  const dest = path.join(archiveDir, path.basename(adFolderPath));
  if (fs.existsSync(dest)) return;
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.renameSync(adFolderPath, dest);
}

// Move an archived ad folder (by its full path inside archive/) back into downloadDir
export function unarchiveAdFolder(archivedFolderPath: string, downloadDir: string): void {
  if (!fs.existsSync(archivedFolderPath)) return;
  const dest = path.join(downloadDir, path.basename(archivedFolderPath));
  if (fs.existsSync(dest)) return;
  fs.mkdirSync(downloadDir, { recursive: true });
  fs.renameSync(archivedFolderPath, dest);
}
