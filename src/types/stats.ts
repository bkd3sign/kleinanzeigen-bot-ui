// Metrics snapshot — no timestamp (date is the key in history)
export interface AdStatsHistoryEntry {
  views: number;
  watchlist: number;
  replies: number;
  state: string;
  expires_at: string | null;
}

// Current snapshot — metrics plus activation date
export interface AdStatsEntry extends AdStatsHistoryEntry {
  activated_at: string | null;
}

export interface AdStatsRecord {
  current: AdStatsEntry;
  history: Record<string, AdStatsHistoryEntry>; // key = YYYY-MM-DD
}

export interface StatsFile {
  last_updated: string;
  ads: Record<string, AdStatsRecord>; // key = KA ad ID (string)
}
