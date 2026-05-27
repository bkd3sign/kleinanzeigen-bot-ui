import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { writeAd, readAd } from '@/lib/yaml/ads';
import { mergeDraftPairs } from '../hooks';

let workspace: string;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-drafts-'));
  delete process.env.BOT_DIR;
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
  delete process.env.BOT_DIR;
});

function makeAd(dir: string, slug: string, data: Record<string, unknown>): string {
  const folder = path.join(dir, slug);
  fs.mkdirSync(folder, { recursive: true });
  const filePath = path.join(folder, `${slug}.yaml`);
  writeAd(filePath, data);
  return filePath;
}

describe('mergeDraftPairs', () => {
  it('merges matching draft+download: LOCAL_ONLY_FIELDS applied, ad subfolder deleted', () => {
    const adsDir = path.join(workspace, 'ads');
    const dlDir = path.join(workspace, 'downloaded-ads');

    const draftPath = makeAd(adsDir, 'ad_fahrrad', {
      title: 'Fahrrad 26 Zoll',
      category: '217/221',
      price: 50,
      active: true,
      republication_interval: 7,
      auto_price_reduction: { enabled: true, amount: 5, min_price: 30 },
      repost_count: 2,
      price_reduction_count: 1,
    });

    const dlPath = makeAd(dlDir, 'ad_fahrrad_ka', {
      id: 2001,
      title: 'Fahrrad 26 Zoll',
      category: '217/221',
      price: 50,
      active: true,
      created_on: '2026-05-01T10:00:00',
    });

    const count = mergeDraftPairs(workspace);

    expect(count).toBe(1);
    // The specific ad subfolder /ads/ad_fahrrad/ is deleted (YAML + images)
    expect(fs.existsSync(path.dirname(draftPath))).toBe(false);
    // The parent /ads/ directory itself still exists
    expect(fs.existsSync(adsDir)).toBe(true);
    // downloaded version has LOCAL_ONLY_FIELDS from draft
    const merged = readAd(dlPath);
    expect(merged.id).toBe(2001);
    expect(merged.created_on).toBe('2026-05-01T10:00:00');
    expect(merged.republication_interval).toBe(7);
    expect(merged.repost_count).toBe(2);
    expect(merged.price_reduction_count).toBe(1);
    expect(merged.auto_price_reduction).toMatchObject({ enabled: true, amount: 5, min_price: 30 });
    // content_hash recomputed
    expect(typeof merged.content_hash).toBe('string');
    expect((merged.content_hash as string).length).toBe(64);
  });

  it('deletes entire ad subfolder including images on merge', () => {
    const adsDir = path.join(workspace, 'ads');
    const dlDir = path.join(workspace, 'downloaded-ads');

    const folder = path.join(adsDir, 'ad_bild');
    fs.mkdirSync(folder, { recursive: true });
    writeAd(path.join(folder, 'ad_bild.yaml'), {
      title: 'Bild mit Foto',
      category: '161',
      active: true,
    });
    fs.writeFileSync(path.join(folder, 'foto.jpg'), 'fake-image');

    makeAd(dlDir, 'ad_bild_ka', { id: 4001, title: 'Bild mit Foto', category: '161', active: true });

    const count = mergeDraftPairs(workspace);

    expect(count).toBe(1);
    expect(fs.existsSync(folder)).toBe(false);
  });

  it('skips ambiguous: 2 drafts with same title+category', () => {
    const adsDir = path.join(workspace, 'ads');
    const dlDir = path.join(workspace, 'downloaded-ads');

    makeAd(adsDir, 'ad_couch_1', { title: 'Couch grau', category: '174', active: true });
    makeAd(adsDir, 'ad_couch_2', { title: 'Couch grau', category: '174', active: true });
    makeAd(dlDir, 'ad_couch_ka', { id: 3001, title: 'Couch grau', category: '174', active: true });

    const count = mergeDraftPairs(workspace);

    expect(count).toBe(0);
    expect(fs.existsSync(path.join(adsDir, 'ad_couch_1'))).toBe(true);
    expect(fs.existsSync(path.join(adsDir, 'ad_couch_2'))).toBe(true);
  });

  it('skips draft with no matching download', () => {
    const adsDir = path.join(workspace, 'ads');

    const draftPath = makeAd(adsDir, 'ad_solo', {
      title: 'Solo Lampe',
      category: '161',
      active: true,
      republication_interval: 14,
    });

    const count = mergeDraftPairs(workspace);

    expect(count).toBe(0);
    expect(fs.existsSync(path.dirname(draftPath))).toBe(true);
  });

  it('ignores drafts that already have an id', () => {
    const adsDir = path.join(workspace, 'ads');
    const dlDir = path.join(workspace, 'downloaded-ads');

    const draftPath = makeAd(adsDir, 'ad_with_id', {
      id: 9999,
      title: 'Schrank alt',
      category: '161',
      active: true,
    });
    makeAd(dlDir, 'ad_schrank_ka', {
      id: 9999,
      title: 'Schrank alt',
      category: '161',
      active: true,
    });

    const count = mergeDraftPairs(workspace);

    expect(count).toBe(0);
    expect(fs.existsSync(path.dirname(draftPath))).toBe(true);
  });

  it('returns 0 immediately when workspace has no draft files', () => {
    const count = mergeDraftPairs(workspace);
    expect(count).toBe(0);
  });
});
