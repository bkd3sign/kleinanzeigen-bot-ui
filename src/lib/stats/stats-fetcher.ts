import fs from 'fs';
import path from 'path';
import type { StatsFile, AdStatsEntry, AdStatsHistoryEntry } from '@/types/stats';
import { fetchKaAds, type KaManageAd } from '@/lib/ka/management-api';

const STATS_FILE = '.ad-stats.json';

function toHistoryEntry(entry: AdStatsEntry): AdStatsHistoryEntry {
  return {
    views: entry.views,
    watchlist: entry.watchlist,
    replies: entry.replies,
    state: entry.state,
    expires_at: entry.expires_at,
  };
}

function migrateHistoryEntry(e: Record<string, unknown>): AdStatsHistoryEntry {
  return {
    views: (e.views as number) ?? 0,
    watchlist: (e.watchlist as number) ?? 0,
    replies: (e.replies as number) ?? 0,
    state: (e.state as string) ?? 'unknown',
    expires_at: (e.expires_at as string | null) ?? null,
  };
}

export function loadStats(workspace: string): StatsFile {
  const filePath = path.join(workspace, STATS_FILE);
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    const ads = raw.ads as Record<string, { current: Record<string, unknown>; history: unknown }>;

    for (const record of Object.values(ads)) {
      // Migrate array → date-keyed object
      if (Array.isArray(record.history)) {
        const migrated: Record<string, AdStatsHistoryEntry> = {};
        for (const e of record.history as Array<Record<string, unknown>>) {
          const dateKey = ((e.at as string) ?? '').split('T')[0] || new Date().toISOString().split('T')[0];
          migrated[dateKey] = migrateHistoryEntry(e);
        }
        record.history = migrated;
      }
    }

    return raw as unknown as StatsFile;
  } catch {
    return { last_updated: '', ads: {} };
  }
}

function saveStats(workspace: string, stats: StatsFile): void {
  fs.writeFileSync(path.join(workspace, STATS_FILE), JSON.stringify(stats), 'utf-8');
}

// Exported for unit testing
export function buildStatsEntry(ad: KaManageAd): AdStatsEntry {
  return {
    views: ad.viewCount ?? 0,
    watchlist: ad.watchCount ?? 0,
    replies: ad.replies ?? 0,
    state: ad.state ?? 'unknown',
    activated_at: ad.activationDate || null,
    expires_at: ad.endDate || null,
  };
}

/**
 * Fetch ad stats from the KA management API and persist to {workspace}/.ad-stats.json.
 * Runs entirely via HTTP — no Chrome or CDP dependency.
 */
export async function fetchAdStats(workspace: string): Promise<KaManageAd[]> {
  const fetchedAds = await fetchKaAds(workspace);
  if (fetchedAds.length === 0) return [];

  const stats = loadStats(workspace);
  const now = new Date().toISOString();
  const dateKey = now.split('T')[0];
  const apiIds = new Set(fetchedAds.map(a => String(a.id)));

  // Remove entries for ads no longer published on KA
  for (const key of Object.keys(stats.ads)) {
    if (!apiIds.has(key)) delete stats.ads[key];
  }

  for (const ad of fetchedAds) {
    const key = String(ad.id);
    const entry = buildStatsEntry(ad);
    const existing = stats.ads[key];
    stats.ads[key] = {
      current: entry,
      history: { ...(existing?.history ?? {}), [dateKey]: toHistoryEntry(entry) },
    };
  }

  stats.last_updated = now;
  saveStats(workspace, stats);
  return fetchedAds;
}
