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

  it('excludes directories passed in excludeDirs', () => {
    const archiveDir = path.join(tmpDir, 'downloaded-ads', 'archive');
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'ads', 'ad_active.yaml'), 'title: Active\n');
    fs.writeFileSync(path.join(archiveDir, 'ad_archived.yaml'), 'title: Archived\n');

    const files = findAdFiles(tmpDir, { excludeDirs: [archiveDir] });

    expect(files).toHaveLength(1);
    expect(files[0]).toContain('ad_active.yaml');
  });
});

describe('findAdFiles — honors ad_files glob', () => {
  function writeConfig(adFiles: string[] | null): void {
    const body = adFiles ? `ad_files:\n${adFiles.map(p => `  - "${p}"`).join('\n')}\n` : 'login: {}\n';
    fs.writeFileSync(path.join(tmpDir, 'config.yaml'), body, 'utf-8');
  }
  function writeAdFile(relPath: string, id: number): void {
    const full = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `id: ${id}\ntitle: "Ad ${id}"\n`, 'utf-8');
  }

  it('scenario 1: default ad_files finds ad_<id> files', () => {
    writeConfig(['./**/ad_*.{json,yml,yaml}']);
    writeAdFile('downloaded-ads/ad_2000/ad_2000.yaml', 2000);
    const files = findAdFiles(tmpDir);
    expect(files.some(f => f.endsWith('ad_2000.yaml'))).toBe(true);
  });

  it('scenario 4: non-ad_ filename is found when ad_files matches it', () => {
    writeConfig(['./**/*.yaml']);
    writeAdFile('downloaded-ads/bike/Fahrrad (2000).yaml', 2000);
    const files = findAdFiles(tmpDir);
    expect(files.some(f => f.endsWith('Fahrrad (2000).yaml'))).toBe(true);
  });

  it('scenario 7: never returns config.yaml / users.yaml even with a broad glob', () => {
    writeConfig(['./**/*.yaml']);
    fs.writeFileSync(path.join(tmpDir, 'users.yaml'), 'users: []\n', 'utf-8');
    writeAdFile('downloaded-ads/x/ad_5.yaml', 5);
    const files = findAdFiles(tmpDir).map(f => path.basename(f));
    expect(files).not.toContain('config.yaml');
    expect(files).not.toContain('users.yaml');
    expect(files).toContain('ad_5.yaml');
  });

  it('scenario 8: never returns dotfiles like .ad-stats.json', () => {
    writeConfig(['./**/*.{json,yaml}']);
    fs.writeFileSync(path.join(tmpDir, '.ad-stats.json'), '{}', 'utf-8');
    writeAdFile('downloaded-ads/x/ad_9.yaml', 9);
    const files = findAdFiles(tmpDir).map(f => path.basename(f));
    expect(files).not.toContain('.ad-stats.json');
    expect(files).toContain('ad_9.yaml');
  });

  it('excludes the ads/templates directory', () => {
    writeConfig(['./**/ad_*.{json,yml,yaml}']);
    writeAdFile('ads/templates/ad_tmpl.yaml', 1);
    writeAdFile('ads/ad_real.yaml', 2);
    const files = findAdFiles(tmpDir).map(f => path.basename(f));
    expect(files).toContain('ad_real.yaml');
    expect(files).not.toContain('ad_tmpl.yaml');
  });

  it('scanDir restricts results to a subtree', () => {
    writeConfig(['./**/ad_*.{json,yml,yaml}']);
    writeAdFile('downloaded-ads/ad_10.yaml', 10);
    writeAdFile('ads/ad_11.yaml', 11);
    const files = findAdFiles(tmpDir, { scanDir: path.join(tmpDir, 'downloaded-ads') }).map(f => path.basename(f));
    expect(files).toContain('ad_10.yaml');
    expect(files).not.toContain('ad_11.yaml');
  });

  it('excludeDirs filters out an excluded subtree', () => {
    writeConfig(['./**/ad_*.{json,yml,yaml}']);
    writeAdFile('downloaded-ads/ad_20.yaml', 20);
    writeAdFile('archive/ad_21.yaml', 21);
    const files = findAdFiles(tmpDir, { excludeDirs: [path.join(tmpDir, 'archive')] }).map(f => path.basename(f));
    expect(files).toContain('ad_20.yaml');
    expect(files).not.toContain('ad_21.yaml');
  });

  it('multi-user: reads ad_files from the BOT_DIR root config when the workspace config lacks it', () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ads-root-'));
    const userWs = path.join(rootDir, 'users', 'u1');
    fs.mkdirSync(path.join(userWs, 'ads', 'templates'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'config.yaml'), 'ad_files:\n  - "./**/*.yaml"\n', 'utf-8');
    fs.writeFileSync(path.join(userWs, 'config.yaml'), 'login:\n  username: u1\n', 'utf-8');
    fs.mkdirSync(path.join(userWs, 'downloaded-ads', 'bike'), { recursive: true });
    fs.writeFileSync(path.join(userWs, 'downloaded-ads', 'bike', 'Fahrrad (7).yaml'), 'id: 7\ntitle: "Bike"\n', 'utf-8');

    const prevBotDir = process.env.BOT_DIR;
    process.env.BOT_DIR = rootDir;
    try {
      const files = findAdFiles(userWs).map(f => path.basename(f));
      expect(files).toContain('Fahrrad (7).yaml');
      expect(files).not.toContain('config.yaml');
    } finally {
      if (prevBotDir === undefined) delete process.env.BOT_DIR;
      else process.env.BOT_DIR = prevBotDir;
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('falls back to the default pattern when ad_files is absent', () => {
    writeConfig(null);
    writeAdFile('downloaded-ads/ad_30.yaml', 30);
    fs.writeFileSync(path.join(tmpDir, 'downloaded-ads', 'notes.txt'), 'x', 'utf-8');
    const files = findAdFiles(tmpDir).map(f => path.basename(f));
    expect(files).toContain('ad_30.yaml');
    expect(files).not.toContain('notes.txt');
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

  it('falls back to archive/downloads when file was archived from downloaded-ads', () => {
    const archivedDir = path.join(tmpDir, 'archive', 'downloads', 'ad_X');
    fs.mkdirSync(archivedDir, { recursive: true });
    fs.writeFileSync(path.join(archivedDir, 'ad_X.yaml'), 'title: Archived\n');

    const result = findAdByFile('downloaded-ads/ad_X/ad_X.yaml', tmpDir);
    expect(result).not.toBeNull();
    expect(result!.ad.title).toBe('Archived');
    expect(result!.path).toBe(path.join(archivedDir, 'ad_X.yaml'));
  });

  it('falls back to archive/ads when draft was archived from ads', () => {
    const archivedDir = path.join(tmpDir, 'archive', 'ads', 'ad_Y');
    fs.mkdirSync(archivedDir, { recursive: true });
    fs.writeFileSync(path.join(archivedDir, 'ad_Y.yaml'), 'title: ArchivedDraft\n');

    const result = findAdByFile('ads/ad_Y/ad_Y.yaml', tmpDir);
    expect(result).not.toBeNull();
    expect(result!.ad.title).toBe('ArchivedDraft');
  });

  it('falls back to downloaded-ads when ad was unarchived', () => {
    const liveDir = path.join(tmpDir, 'downloaded-ads', 'ad_Z');
    fs.mkdirSync(liveDir, { recursive: true });
    fs.writeFileSync(path.join(liveDir, 'ad_Z.yaml'), 'title: Live\n');

    const result = findAdByFile('archive/downloads/ad_Z/ad_Z.yaml', tmpDir);
    expect(result).not.toBeNull();
    expect(result!.ad.title).toBe('Live');
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

  it('removes shipping_costs key when updated to null (migration)', () => {
    const ad: Record<string, unknown> = { title: 'Old', shipping_costs: 4.99 };
    applyAdUpdates(ad, { shipping_costs: null });
    expect('shipping_costs' in ad).toBe(false);
  });

  it('removes shipping_costs key when updated to undefined (migration)', () => {
    const ad: Record<string, unknown> = { title: 'Old', shipping_costs: 4.99 };
    applyAdUpdates(ad, { shipping_costs: undefined });
    expect('shipping_costs' in ad).toBe(false);
  });
});
