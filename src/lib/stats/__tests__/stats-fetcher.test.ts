import { describe, it, expect } from 'vitest';
import { buildStatsEntry } from '../stats-fetcher';

describe('buildStatsEntry', () => {
  it('maps all KA management API fields', () => {
    const entry = buildStatsEntry({
      id: 123,
      title: 'Test Anzeige',
      price: '100 € VB',
      category: 'Sport',
      imageCount: 5,
      viewCount: 14,
      watchCount: 3,
      replies: 2,
      state: 'active',
      activationDate: '07.04.2026',
      endDate: '21.06.2026',
    });
    expect(entry).toEqual({
      views: 14,
      watchlist: 3,
      replies: 2,
      state: 'active',
      activated_at: '07.04.2026',
      expires_at: '21.06.2026',
    });
  });

  it('uses 0 for missing viewCount, watchCount and replies', () => {
    const entry = buildStatsEntry(
      { id: 456, title: 'X', price: '', category: '', imageCount: 0, viewCount: 0, watchCount: 0, replies: 0, state: 'active' },
    );
    expect(entry.views).toBe(0);
    expect(entry.watchlist).toBe(0);
    expect(entry.replies).toBe(0);
  });

  it('returns null for missing optional date fields', () => {
    const entry = buildStatsEntry(
      { id: 789, title: 'Y', price: '', category: '', imageCount: 0, viewCount: 5, watchCount: 1, replies: 0, state: 'active' },
    );
    expect(entry.activated_at).toBeNull();
    expect(entry.expires_at).toBeNull();
  });

  it('returns null for empty endDate and activationDate strings', () => {
    const entry = buildStatsEntry(
      { id: 789, title: 'Z', price: '', category: '', imageCount: 0, viewCount: 5, watchCount: 1, replies: 0, state: 'active', endDate: '', activationDate: '' },
    );
    expect(entry.expires_at).toBeNull();
    expect(entry.activated_at).toBeNull();
  });
});
