import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  resolveArchiveDir,
  resolveArchiveSubDir,
  archiveAdFolder,
  unarchiveAdFolder,
  migrateArchiveIfNeeded,
  ARCHIVE_SUBDIR_ADS,
  ARCHIVE_SUBDIR_DOWNLOADS,
} from '../archive';

let workspace: string;
let downloadDir: string;
let adsDir: string;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-test-'));
  downloadDir = path.join(workspace, 'downloaded-ads');
  adsDir = path.join(workspace, 'ads');
  fs.mkdirSync(downloadDir, { recursive: true });
  fs.mkdirSync(adsDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

describe('resolveArchiveDir', () => {
  it('returns archive dir at workspace root', () => {
    expect(resolveArchiveDir('/workspace')).toBe(path.join('/workspace', 'archive'));
  });
});

describe('resolveArchiveSubDir', () => {
  it('returns ads subdir', () => {
    expect(resolveArchiveSubDir('/workspace', ARCHIVE_SUBDIR_ADS))
      .toBe(path.join('/workspace', 'archive', 'ads'));
  });

  it('returns downloads subdir', () => {
    expect(resolveArchiveSubDir('/workspace', ARCHIVE_SUBDIR_DOWNLOADS))
      .toBe(path.join('/workspace', 'archive', 'downloads'));
  });
});

describe('archiveAdFolder', () => {
  it('moves ad from downloaded-ads to archive/downloads', () => {
    const adFolder = path.join(downloadDir, 'ad_my_item');
    fs.mkdirSync(adFolder);
    fs.writeFileSync(path.join(adFolder, 'ad_my_item.yaml'), 'id: 123\n');

    archiveAdFolder(adFolder, workspace, ARCHIVE_SUBDIR_DOWNLOADS);

    expect(fs.existsSync(adFolder)).toBe(false);
    expect(
      fs.existsSync(path.join(workspace, 'archive', 'downloads', 'ad_my_item', 'ad_my_item.yaml'))
    ).toBe(true);
  });

  it('moves ad from ads to archive/ads', () => {
    const adFolder = path.join(adsDir, 'ad_my_draft');
    fs.mkdirSync(adFolder);
    fs.writeFileSync(path.join(adFolder, 'ad_my_draft.yaml'), 'active: false\n');

    archiveAdFolder(adFolder, workspace, ARCHIVE_SUBDIR_ADS);

    expect(fs.existsSync(adFolder)).toBe(false);
    expect(
      fs.existsSync(path.join(workspace, 'archive', 'ads', 'ad_my_draft', 'ad_my_draft.yaml'))
    ).toBe(true);
  });

  it('creates the archive subdir when it does not exist', () => {
    const adFolder = path.join(downloadDir, 'ad_new_item');
    fs.mkdirSync(adFolder);
    archiveAdFolder(adFolder, workspace, ARCHIVE_SUBDIR_DOWNLOADS);
    expect(fs.existsSync(path.join(workspace, 'archive', 'downloads'))).toBe(true);
  });

  it('is a no-op when the source folder does not exist', () => {
    const adFolder = path.join(downloadDir, 'ad_nonexistent');
    expect(() => archiveAdFolder(adFolder, workspace, ARCHIVE_SUBDIR_DOWNLOADS)).not.toThrow();
    expect(fs.existsSync(path.join(workspace, 'archive'))).toBe(false);
  });

  it('moves images alongside the YAML', () => {
    const adFolder = path.join(downloadDir, 'ad_with_images');
    fs.mkdirSync(adFolder);
    fs.writeFileSync(path.join(adFolder, 'ad_with_images.yaml'), 'id: 789\n');
    fs.writeFileSync(path.join(adFolder, 'ad_with_images__img1.jpg'), 'img');

    archiveAdFolder(adFolder, workspace, ARCHIVE_SUBDIR_DOWNLOADS);

    expect(
      fs.existsSync(path.join(workspace, 'archive', 'downloads', 'ad_with_images', 'ad_with_images__img1.jpg'))
    ).toBe(true);
  });

  it('is a no-op when the destination already exists', () => {
    const adFolder = path.join(downloadDir, 'ad_duplicate');
    const archiveFolder = path.join(workspace, 'archive', 'downloads', 'ad_duplicate');
    fs.mkdirSync(adFolder);
    fs.mkdirSync(archiveFolder, { recursive: true });
    fs.writeFileSync(path.join(archiveFolder, 'existing.yaml'), 'id: 123\n');

    archiveAdFolder(adFolder, workspace, ARCHIVE_SUBDIR_DOWNLOADS);

    expect(fs.existsSync(adFolder)).toBe(true);
    expect(fs.existsSync(path.join(archiveFolder, 'existing.yaml'))).toBe(true);
  });
});

describe('unarchiveAdFolder', () => {
  it('restores from archive/downloads to downloaded-ads', () => {
    const archiveSubDir = path.join(workspace, 'archive', 'downloads', 'ad_my_item');
    fs.mkdirSync(archiveSubDir, { recursive: true });
    fs.writeFileSync(path.join(archiveSubDir, 'ad_my_item.yaml'), 'id: 123\n');

    unarchiveAdFolder(archiveSubDir, workspace, adsDir, downloadDir);

    expect(fs.existsSync(archiveSubDir)).toBe(false);
    expect(fs.existsSync(path.join(downloadDir, 'ad_my_item', 'ad_my_item.yaml'))).toBe(true);
  });

  it('restores from archive/ads back to ads dir', () => {
    const archiveSubDir = path.join(workspace, 'archive', 'ads', 'ad_my_draft');
    fs.mkdirSync(archiveSubDir, { recursive: true });
    fs.writeFileSync(path.join(archiveSubDir, 'ad_my_draft.yaml'), 'active: false\n');

    unarchiveAdFolder(archiveSubDir, workspace, adsDir, downloadDir);

    expect(fs.existsSync(archiveSubDir)).toBe(false);
    expect(fs.existsSync(path.join(adsDir, 'ad_my_draft', 'ad_my_draft.yaml'))).toBe(true);
  });

  it('is a no-op when the archived folder does not exist', () => {
    const archiveSubDir = path.join(workspace, 'archive', 'downloads', 'ad_nonexistent');
    expect(() => unarchiveAdFolder(archiveSubDir, workspace, adsDir, downloadDir)).not.toThrow();
  });

  it('is a no-op when the destination already exists', () => {
    const adFolder = path.join(downloadDir, 'ad_existing');
    const archiveSubDir = path.join(workspace, 'archive', 'downloads', 'ad_existing');
    fs.mkdirSync(adFolder, { recursive: true });
    fs.mkdirSync(archiveSubDir, { recursive: true });
    fs.writeFileSync(path.join(adFolder, 'existing.yaml'), 'id: 123\n');

    unarchiveAdFolder(archiveSubDir, workspace, adsDir, downloadDir);

    expect(fs.existsSync(archiveSubDir)).toBe(true);
    expect(fs.existsSync(path.join(adFolder, 'existing.yaml'))).toBe(true);
  });
});

describe('migrateArchiveIfNeeded', () => {
  it('moves old downloaded-ads/archive contents to workspace/archive/downloads', () => {
    const oldArchiveDir = path.join(downloadDir, 'archive');
    const oldFolder = path.join(oldArchiveDir, 'ad_old_item');
    fs.mkdirSync(oldFolder, { recursive: true });
    fs.writeFileSync(path.join(oldFolder, 'ad_old_item.yaml'), 'id: 456\n');

    migrateArchiveIfNeeded(workspace, downloadDir);

    expect(fs.existsSync(oldFolder)).toBe(false);
    expect(
      fs.existsSync(path.join(workspace, 'archive', 'downloads', 'ad_old_item', 'ad_old_item.yaml'))
    ).toBe(true);
  });

  it('removes old archive dir after all items are migrated', () => {
    const oldArchiveDir = path.join(downloadDir, 'archive');
    fs.mkdirSync(path.join(oldArchiveDir, 'ad_item'), { recursive: true });
    fs.writeFileSync(path.join(oldArchiveDir, 'ad_item', 'ad_item.yaml'), 'id: 1\n');

    migrateArchiveIfNeeded(workspace, downloadDir);

    expect(fs.existsSync(oldArchiveDir)).toBe(false);
  });

  it('is a no-op when there is no old archive', () => {
    expect(() => migrateArchiveIfNeeded(workspace, downloadDir)).not.toThrow();
    expect(fs.existsSync(path.join(workspace, 'archive'))).toBe(false);
  });

  it('does not overwrite existing entry in the new location', () => {
    const oldArchiveDir = path.join(downloadDir, 'archive');
    const oldFolder = path.join(oldArchiveDir, 'ad_conflict');
    const newFolder = path.join(workspace, 'archive', 'downloads', 'ad_conflict');

    fs.mkdirSync(oldFolder, { recursive: true });
    fs.writeFileSync(path.join(oldFolder, 'ad_conflict.yaml'), 'id: 1\n');
    fs.mkdirSync(newFolder, { recursive: true });
    fs.writeFileSync(path.join(newFolder, 'ad_conflict.yaml'), 'id: 2\n');

    migrateArchiveIfNeeded(workspace, downloadDir);

    expect(fs.readFileSync(path.join(newFolder, 'ad_conflict.yaml'), 'utf-8')).toBe('id: 2\n');
  });

  it('keeps old archive dir when some items could not be migrated', () => {
    const oldArchiveDir = path.join(downloadDir, 'archive');
    const oldFolder = path.join(oldArchiveDir, 'ad_conflict');
    const newFolder = path.join(workspace, 'archive', 'downloads', 'ad_conflict');

    fs.mkdirSync(oldFolder, { recursive: true });
    fs.writeFileSync(path.join(oldFolder, 'ad_conflict.yaml'), 'id: 1\n');
    fs.mkdirSync(newFolder, { recursive: true });
    fs.writeFileSync(path.join(newFolder, 'ad_conflict.yaml'), 'id: 2\n');

    migrateArchiveIfNeeded(workspace, downloadDir);

    expect(fs.existsSync(oldArchiveDir)).toBe(true);
  });

  it('removes empty old archive dir', () => {
    const oldArchiveDir = path.join(downloadDir, 'archive');
    fs.mkdirSync(oldArchiveDir, { recursive: true });

    migrateArchiveIfNeeded(workspace, downloadDir);

    expect(fs.existsSync(oldArchiveDir)).toBe(false);
  });

  it('removes old archive dir along with stray non-directory files after full migration', () => {
    const oldArchiveDir = path.join(downloadDir, 'archive');
    fs.mkdirSync(path.join(oldArchiveDir, 'ad_item'), { recursive: true });
    fs.writeFileSync(path.join(oldArchiveDir, 'ad_item', 'ad_item.yaml'), 'id: 1\n');
    fs.writeFileSync(path.join(oldArchiveDir, '.DS_Store'), 'macos-junk');

    migrateArchiveIfNeeded(workspace, downloadDir);

    expect(fs.existsSync(oldArchiveDir)).toBe(false);
    expect(
      fs.existsSync(path.join(workspace, 'archive', 'downloads', 'ad_item', 'ad_item.yaml'))
    ).toBe(true);
  });
});
