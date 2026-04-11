import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolveImageFiles, getFirstImage } from '../resolve';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'images-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('resolveImageFiles', () => {
  it('returns filenames matching patterns', () => {
    fs.writeFileSync(path.join(tmpDir, 'photo1.jpg'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'photo2.png'), 'fake');

    const result = resolveImageFiles(tmpDir, ['*.jpg', '*.png']);
    expect(result).toContain('photo1.jpg');
    expect(result).toContain('photo2.png');
  });

  it('deduplicates results', () => {
    fs.writeFileSync(path.join(tmpDir, 'image.jpg'), 'fake');

    // Both patterns match the same file
    const result = resolveImageFiles(tmpDir, ['*.jpg', 'image.*']);
    const jpgCount = result.filter((f) => f === 'image.jpg').length;
    expect(jpgCount).toBe(1);
  });

  it('filters by allowed extensions', () => {
    fs.writeFileSync(path.join(tmpDir, 'photo.jpg'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'script.js'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'doc.txt'), 'fake');

    const result = resolveImageFiles(tmpDir, ['*.*']);
    expect(result).toContain('photo.jpg');
    expect(result).not.toContain('script.js');
    expect(result).not.toContain('doc.txt');
  });

  it('returns empty array when no matches', () => {
    const result = resolveImageFiles(tmpDir, ['*.jpg']);
    expect(result).toEqual([]);
  });

  it('handles subdirectory patterns', () => {
    const subDir = path.join(tmpDir, 'photos');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'nested.png'), 'fake');

    const result = resolveImageFiles(tmpDir, ['photos/*.png']);
    expect(result).toContain('nested.png');
  });
});

describe('getFirstImage', () => {
  it('returns first match', () => {
    fs.writeFileSync(path.join(tmpDir, 'a_first.jpg'), 'fake');
    fs.writeFileSync(path.join(tmpDir, 'b_second.jpg'), 'fake');

    const result = getFirstImage(tmpDir, ['*.jpg']);
    expect(result).toBe('a_first.jpg');
  });

  it('returns null when no images', () => {
    const result = getFirstImage(tmpDir, ['*.jpg']);
    expect(result).toBeNull();
  });

  it('skips non-image files', () => {
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'text');

    const result = getFirstImage(tmpDir, ['*.*']);
    expect(result).toBeNull();
  });

  it('finds first image across multiple patterns', () => {
    fs.writeFileSync(path.join(tmpDir, 'photo.png'), 'fake');

    const result = getFirstImage(tmpDir, ['*.jpg', '*.png']);
    expect(result).toBe('photo.png');
  });
});
