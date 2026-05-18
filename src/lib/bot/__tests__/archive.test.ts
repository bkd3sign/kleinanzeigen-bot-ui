import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolveArchiveDir, archiveAdFolder, unarchiveAdFolder } from '../archive';

let downloadDir: string;

beforeEach(() => {
  downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-test-'));
});

afterEach(() => {
  fs.rmSync(downloadDir, { recursive: true, force: true });
});

describe('resolveArchiveDir', () => {
  it('returns archive subdir within download dir', () => {
    expect(resolveArchiveDir('/some/dl')).toBe(path.join('/some/dl', 'archive'));
  });
});

describe('archiveAdFolder', () => {
  it('moves the ad folder from download dir to archive subdir', () => {
    const adFolder = path.join(downloadDir, 'ad_my_item');
    fs.mkdirSync(adFolder);
    fs.writeFileSync(path.join(adFolder, 'ad_my_item.yaml'), 'id: 123\n');

    archiveAdFolder(adFolder, downloadDir);

    expect(fs.existsSync(adFolder)).toBe(false);
    expect(fs.existsSync(path.join(downloadDir, 'archive', 'ad_my_item', 'ad_my_item.yaml'))).toBe(true);
  });

  it('creates the archive dir when it does not yet exist', () => {
    const adFolder = path.join(downloadDir, 'ad_new_item');
    fs.mkdirSync(adFolder);

    archiveAdFolder(adFolder, downloadDir);

    expect(fs.existsSync(path.join(downloadDir, 'archive'))).toBe(true);
  });

  it('is a no-op when the source folder does not exist', () => {
    const adFolder = path.join(downloadDir, 'ad_nonexistent');
    expect(() => archiveAdFolder(adFolder, downloadDir)).not.toThrow();
    expect(fs.existsSync(path.join(downloadDir, 'archive'))).toBe(false);
  });

  it('moves images alongside the YAML', () => {
    const adFolder = path.join(downloadDir, 'ad_with_images');
    fs.mkdirSync(adFolder);
    fs.writeFileSync(path.join(adFolder, 'ad_with_images.yaml'), 'id: 789\n');
    fs.writeFileSync(path.join(adFolder, 'ad_with_images__img1.jpg'), 'img');

    archiveAdFolder(adFolder, downloadDir);

    expect(fs.existsSync(path.join(downloadDir, 'archive', 'ad_with_images', 'ad_with_images__img1.jpg'))).toBe(true);
  });

  it('is a no-op when the destination already exists', () => {
    const adFolder = path.join(downloadDir, 'ad_duplicate');
    const archiveFolder = path.join(downloadDir, 'archive', 'ad_duplicate');
    fs.mkdirSync(adFolder);
    fs.mkdirSync(archiveFolder, { recursive: true });
    fs.writeFileSync(path.join(archiveFolder, 'existing.yaml'), 'id: 123\n');

    archiveAdFolder(adFolder, downloadDir);

    expect(fs.existsSync(adFolder)).toBe(true);
    expect(fs.existsSync(path.join(archiveFolder, 'existing.yaml'))).toBe(true);
  });
});

describe('unarchiveAdFolder', () => {
  it('moves the archived folder back into the download dir', () => {
    const archiveSubDir = path.join(downloadDir, 'archive', 'ad_my_item');
    fs.mkdirSync(archiveSubDir, { recursive: true });
    fs.writeFileSync(path.join(archiveSubDir, 'ad_my_item.yaml'), 'id: 123\n');

    unarchiveAdFolder(archiveSubDir, downloadDir);

    expect(fs.existsSync(archiveSubDir)).toBe(false);
    expect(fs.existsSync(path.join(downloadDir, 'ad_my_item', 'ad_my_item.yaml'))).toBe(true);
  });

  it('is a no-op when the archived folder does not exist', () => {
    const archiveSubDir = path.join(downloadDir, 'archive', 'ad_nonexistent');
    expect(() => unarchiveAdFolder(archiveSubDir, downloadDir)).not.toThrow();
  });

  it('is a no-op when the destination already exists', () => {
    const adFolder = path.join(downloadDir, 'ad_existing');
    const archiveSubDir = path.join(downloadDir, 'archive', 'ad_existing');
    fs.mkdirSync(adFolder, { recursive: true });
    fs.mkdirSync(archiveSubDir, { recursive: true });
    fs.writeFileSync(path.join(adFolder, 'existing.yaml'), 'id: 123\n');

    unarchiveAdFolder(archiveSubDir, downloadDir);

    expect(fs.existsSync(archiveSubDir)).toBe(true);
    expect(fs.existsSync(path.join(adFolder, 'existing.yaml'))).toBe(true);
  });
});
