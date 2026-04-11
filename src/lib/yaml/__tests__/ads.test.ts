import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { readAd, writeAd, findAdFiles, findAdByFile, applyAdUpdates } from '../ads';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ads-test-'));
  // Create ads directory structure
  fs.mkdirSync(path.join(tmpDir, 'ads', 'templates'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('readAd', () => {
  it('parses YAML file correctly', () => {
    const filePath = path.join(tmpDir, 'ads', 'ad_test.yaml');
    fs.writeFileSync(
      filePath,
      'title: "Test Item"\nprice: 42\nactive: true\n',
      'utf-8',
    );

    const ad = readAd(filePath);
    expect(ad.title).toBe('Test Item');
    expect(ad.price).toBe(42);
    expect(ad.active).toBe(true);
  });

  it('returns empty object for empty file', () => {
    const filePath = path.join(tmpDir, 'ads', 'ad_empty.yaml');
    fs.writeFileSync(filePath, '', 'utf-8');

    const ad = readAd(filePath);
    expect(ad).toEqual({});
  });
});

describe('writeAd', () => {
  it('writes YAML file that can be read back', () => {
    const filePath = path.join(tmpDir, 'ads', 'ad_write.yaml');
    const data = { title: 'Written Ad', price: 99, active: true };

    writeAd(filePath, data);

    expect(fs.existsSync(filePath)).toBe(true);
    const readBack = readAd(filePath);
    expect(readBack.title).toBe('Written Ad');
    expect(readBack.price).toBe(99);
    expect(readBack.active).toBe(true);
  });

  it('preserves nested structures', () => {
    const filePath = path.join(tmpDir, 'ads', 'ad_nested.yaml');
    const data = {
      title: 'Nested',
      contact: { name: 'Test', zipcode: '12345' },
    };

    writeAd(filePath, data);
    const readBack = readAd(filePath);
    expect((readBack.contact as Record<string, unknown>).name).toBe('Test');
    expect((readBack.contact as Record<string, unknown>).zipcode).toBe('12345');
  });
});

describe('findAdFiles', () => {
  it('finds ad_*.yaml files', () => {
    fs.writeFileSync(path.join(tmpDir, 'ads', 'ad_one.yaml'), 'title: One\n');
    fs.writeFileSync(path.join(tmpDir, 'ads', 'ad_two.yaml'), 'title: Two\n');

    const files = findAdFiles(tmpDir);
    expect(files).toHaveLength(2);
    expect(files[0]).toContain('ad_one.yaml');
    expect(files[1]).toContain('ad_two.yaml');
  });

  it('excludes files in templates directory', () => {
    fs.writeFileSync(path.join(tmpDir, 'ads', 'ad_real.yaml'), 'title: Real\n');
    fs.writeFileSync(
      path.join(tmpDir, 'ads', 'templates', 'ad_template.yaml'),
      'title: Template\n',
    );

    const files = findAdFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('ad_real.yaml');
  });

  it('ignores non-ad files', () => {
    fs.writeFileSync(path.join(tmpDir, 'ads', 'ad_valid.yaml'), 'title: Valid\n');
    fs.writeFileSync(path.join(tmpDir, 'ads', 'config.yaml'), 'key: val\n');
    fs.writeFileSync(path.join(tmpDir, 'ads', 'notes.txt'), 'notes\n');

    const files = findAdFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('ad_valid.yaml');
  });

  it('returns sorted results', () => {
    fs.writeFileSync(path.join(tmpDir, 'ads', 'ad_zebra.yaml'), 'title: Z\n');
    fs.writeFileSync(path.join(tmpDir, 'ads', 'ad_alpha.yaml'), 'title: A\n');

    const files = findAdFiles(tmpDir);
    expect(files[0]).toContain('ad_alpha.yaml');
    expect(files[1]).toContain('ad_zebra.yaml');
  });

  it('returns empty array when no ads exist', () => {
    const files = findAdFiles(tmpDir);
    expect(files).toEqual([]);
  });
});

describe('findAdByFile', () => {
  it('finds ad by relative path in ads directory', () => {
    fs.writeFileSync(path.join(tmpDir, 'ads', 'ad_find.yaml'), 'title: Found\n');

    const result = findAdByFile('ads/ad_find.yaml', tmpDir);
    expect(result).not.toBeNull();
    expect(result!.ad.title).toBe('Found');
  });

  it('returns null for path traversal attempts', () => {
    const result = findAdByFile('../../etc/passwd', tmpDir);
    expect(result).toBeNull();
  });

  it('returns null for non-existent file', () => {
    const result = findAdByFile('ads/ad_missing.yaml', tmpDir);
    expect(result).toBeNull();
  });
});

describe('applyAdUpdates', () => {
  it('applies top-level fields', () => {
    const ad: Record<string, unknown> = { title: 'Old', price: 10 };
    applyAdUpdates(ad, { title: 'New', price: 20 });
    expect(ad.title).toBe('New');
    expect(ad.price).toBe(20);
  });

  it('handles contact fields', () => {
    const ad: Record<string, unknown> = {
      title: 'Test',
      contact: { name: 'Original', zipcode: '11111' },
    };
    applyAdUpdates(ad, { contact_name: 'Updated', contact_zipcode: '22222' });
    const contact = ad.contact as Record<string, unknown>;
    expect(contact.name).toBe('Updated');
    expect(contact.zipcode).toBe('22222');
  });

  it('creates contact object if not existing', () => {
    const ad: Record<string, unknown> = { title: 'Test' };
    applyAdUpdates(ad, { contact_name: 'New Name' });
    const contact = ad.contact as Record<string, unknown>;
    expect(contact.name).toBe('New Name');
  });

  it('handles auto_price_reduction', () => {
    const ad: Record<string, unknown> = { title: 'Test' };
    const apr = { enabled: true, strategy: 'PERCENTAGE', amount: 5, min_price: 10 };
    applyAdUpdates(ad, { auto_price_reduction: apr });
    expect(ad.auto_price_reduction).toEqual(apr);
  });

  it('handles special_attributes', () => {
    const ad: Record<string, unknown> = { title: 'Test' };
    applyAdUpdates(ad, { special_attributes: { color: 'blue', size: 'M' } });
    expect(ad.special_attributes).toEqual({ color: 'blue', size: 'M' });
  });

  it('handles mixed updates', () => {
    const ad: Record<string, unknown> = { title: 'Old', price: 10 };
    applyAdUpdates(ad, {
      title: 'New',
      contact_name: 'Test',
      special_attributes: { key: 'val' },
    });
    expect(ad.title).toBe('New');
    expect((ad.contact as Record<string, unknown>).name).toBe('Test');
    expect(ad.special_attributes).toEqual({ key: 'val' });
  });
});
