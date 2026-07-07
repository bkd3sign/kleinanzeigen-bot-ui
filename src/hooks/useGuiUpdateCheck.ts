'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import {
  type GuiUpdateResult,
  UPDATE_CHECK_DATE_KEY,
  UPDATE_CHECK_RESULT_KEY,
  UPDATE_CHECK_DISMISSED_KEY,
  todayStamp,
  shouldCheckToday,
  shouldShowPill,
  parseStoredVersion,
  FALLBACK_VERSION,
} from '@/lib/update-check/pill-state';

// The running GUI version, inlined at build time.
const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? FALLBACK_VERSION;

interface UseGuiUpdateCheck {
  latestVersion: string | null;
  visible: boolean;
  dismiss: () => void;
}

// Checks the GUI version against its GitHub release at most once per day and
// caches the latest release version in localStorage. Only runs when `enabled`
// (admin). Named distinctly from the bot `update-check` mutation (useUpdateCheck
// in lib/api/queries/bot.ts) to avoid a same-name hook collision.
export function useGuiUpdateCheck(enabled: boolean): UseGuiUpdateCheck {
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    setDismissed(localStorage.getItem(UPDATE_CHECK_DISMISSED_KEY));

    const today = todayStamp(new Date());
    const lastCheck = localStorage.getItem(UPDATE_CHECK_DATE_KEY);

    if (!shouldCheckToday(lastCheck, today)) {
      setLatestVersion(parseStoredVersion(localStorage.getItem(UPDATE_CHECK_RESULT_KEY)));
      return;
    }

    let cancelled = false;
    api.get<GuiUpdateResult>('/api/system/gui-version-check')
      .then((result) => {
        if (cancelled) return;
        // Mark the day as checked only on success, so a failed fetch retries
        // on the next load instead of being suppressed until tomorrow.
        localStorage.setItem(UPDATE_CHECK_DATE_KEY, today);
        localStorage.setItem(UPDATE_CHECK_RESULT_KEY, result.latestVersion);
        setLatestVersion(result.latestVersion);
      })
      .catch(() => {
        // GitHub unreachable or 403 (non-admin) — stay silent, use cache.
        if (!cancelled) {
          setLatestVersion(parseStoredVersion(localStorage.getItem(UPDATE_CHECK_RESULT_KEY)));
        }
      });

    return () => { cancelled = true; };
  }, [enabled]);

  const dismiss = useCallback(() => {
    if (!latestVersion) return;
    localStorage.setItem(UPDATE_CHECK_DISMISSED_KEY, latestVersion);
    setDismissed(latestVersion);
  }, [latestVersion]);

  return {
    latestVersion,
    visible: shouldShowPill(latestVersion, dismissed, currentVersion),
    dismiss,
  };
}
