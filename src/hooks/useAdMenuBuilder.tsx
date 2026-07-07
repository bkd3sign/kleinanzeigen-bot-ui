'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useToast, showConfirm } from '@/components/ui';
import type { DropdownMenuItem } from '@/components/ui';
import { api } from '@/lib/api/client';
import { useAds, useUpdateAdByFile } from '@/hooks/useAds';
import type { AdListItem } from '@/types/ad';
import type { Job } from '@/types/bot';
import { isExpired, isExpiringSoon, liveDeleteAvailability } from '@/lib/ads/status';
import { encodeAdFilePath } from '@/lib/ads/paths';
import { confirmRemoveAds, confirmDeleteLiveAds, confirmActivateAndDeleteLiveAd } from '@/lib/ads/confirmations';
import { triggerLiveDelete, activateAndLiveDelete } from '@/lib/ads/ad-actions';

// SVG icon helper for action menu items — shared by every view that renders
// the ad action menu (list + card), so the icon set never drifts.
function Icon({ paths }: { paths: string[] }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

const ICONS: Record<string, string[]> = {
  Bearbeiten: ['M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7', 'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z'],
  Veröffentlichen: ['M22 2L11 13', 'M22 2l-7 20-4-9-9-4 20-7z'],
  Aktualisieren: ['M23 4v6h-6', 'M1 20v-6h6', 'M3.51 9a9 9 0 0 1 14.85-3.36L23 10', 'M20.49 15a9 9 0 0 1-14.85 3.36L1 14'],
  Verlängern: ['M12 2v10l4.5 4.5', 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z'],
  Duplizieren: ['M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2', 'M9 2h6v4H9z'],
  Vorlage: ['M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z', 'M17 21v-8H7v8', 'M7 3v5h8'],
  Löschen: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'],
  Entfernen: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M8 12h8'],
  Deaktivieren: ['M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94', 'M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19', 'M14.12 14.12a3 3 0 0 1-4.24-4.24', 'M1 1l22 22'],
  Aktivieren: ['M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8', 'M12 9a3 3 0 0 1 0 6 3 3 0 0 1 0-6z'],
};

interface AdMenuOptions {
  // Each view owns its own "save as template" modal, so it supplies the opener.
  onSaveAsTemplate: (ad: AdListItem) => void;
}

/**
 * Single source for the ⋮ action menu of an ad. Both AdTable and AdCard call
 * this hook once and use the returned builder per ad — so the action set,
 * wording, icons and behaviour stay identical across list and card views.
 */
export function useAdMenuBuilder({ onSaveAsTemplate }: AdMenuOptions): (ad: AdListItem) => DropdownMenuItem[] {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: allAdsData } = useAds();
  const updateByFile = useUpdateAdByFile();

  const refreshAds = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['ads'] });
  }, [queryClient]);

  // Fire a bot command, then surface feedback: success toast + immediate job-pill refresh.
  const runBotCommand = useCallback(
    (endpoint: string, ads: string, successMsg: string, errorMsg: string) =>
      api.post<Job>(endpoint, { ads })
        .then(() => {
          toast('success', successMsg);
          refreshAds();
          queryClient.invalidateQueries({ queryKey: ['jobs'] });
        })
        .catch((err) => toast('error', err instanceof Error ? err.message : errorMsg)),
    [toast, refreshAds, queryClient],
  );

  return useCallback((ad: AdListItem): DropdownMenuItem[] => {
    const encFile = encodeAdFilePath(ad.file);
    const items: DropdownMenuItem[] = [
      { label: 'Bearbeiten', icon: <Icon paths={ICONS.Bearbeiten} />, onClick: () => router.push(`/ads/edit?file=${encodeURIComponent(ad.file)}`) },
      { label: !ad.active ? 'Aktivieren' : 'Deaktivieren', icon: <Icon paths={!ad.active ? ICONS.Aktivieren : ICONS.Deaktivieren} />, onClick: () => {
        const newActive = !ad.active;
        updateByFile.mutate(
          { filename: ad.file, data: { active: newActive } },
          {
            onSuccess: () => toast('success', newActive ? 'Anzeige aktiviert' : 'Anzeige deaktiviert'),
            onError: (err) => toast('error', err instanceof Error ? err.message : 'Fehler beim Ändern des Status'),
          },
        );
      } },
      { label: ad.id ? 'Erneut veröffentlichen' : 'Veröffentlichen', icon: <Icon paths={ICONS.Veröffentlichen} />, onClick: async () => {
        if (!ad.id) {
          const allDrafts = (allAdsData?.ads ?? []).filter(a => !a.id);
          const ok = await showConfirm(
            'Alle neuen Anzeigen veröffentlichen',
            'Wichtig: Da „' + (ad.title || 'diese Anzeige') + '" noch keine Kleinanzeigen-ID hat, werden alle neuen Anzeigen in deinem Workspace veröffentlicht – nicht nur diese eine.',
            'Alle neuen veröffentlichen',
            'Abbrechen',
            allDrafts.length > 1 ? allDrafts.map(a => a.title || '(Ohne Titel)') : undefined,
          );
          if (!ok) return;
        }
        runBotCommand('/api/bot/publish', ad.id ? String(ad.id) : 'new', 'Veröffentlichung gestartet', 'Fehler beim Veröffentlichen');
      } },
    ];
    if (ad.id) {
      items.push({ label: 'Aktualisieren', icon: <Icon paths={ICONS.Aktualisieren} />, onClick: () => runBotCommand('/api/bot/update', String(ad.id), 'Aktualisierung gestartet', 'Fehler beim Aktualisieren') });
      if (isExpiringSoon(ad) || isExpired(ad)) {
        items.push({ label: 'Verlängern', icon: <Icon paths={ICONS.Verlängern} />, onClick: () => runBotCommand('/api/bot/extend', String(ad.id), 'Verlängerung gestartet', 'Fehler beim Verlängern') });
      }
    }
    items.push({ label: 'Duplizieren', icon: <Icon paths={ICONS.Duplizieren} />, onClick: () => {
      api.post(`/api/ads/duplicate/${encFile}`)
        .then(() => { refreshAds(); toast('success', 'Anzeige dupliziert'); })
        .catch((err) => toast('error', err instanceof Error ? err.message : 'Fehler beim Duplizieren'));
    } });
    items.push({ label: 'Als Vorlage speichern', icon: <Icon paths={ICONS.Vorlage} />, onClick: () => onSaveAsTemplate(ad) });
    items.push({ label: 'Aus Liste entfernen', icon: <Icon paths={ICONS.Entfernen} />, separator: true, onClick: async () => {
      if (!(await confirmRemoveAds(1, ad.title))) return;
      api.delete(`/api/ads/by-file/${encFile}`)
        .then(() => { refreshAds(); toast('success', 'Anzeige entfernt'); })
        .catch((err) => toast('error', err instanceof Error ? err.message : 'Fehler beim Entfernen'));
    } });
    const deleteState = liveDeleteAvailability(ad);
    if (deleteState === 'normal') {
      items.push({ label: 'Inserat löschen', icon: <Icon paths={ICONS.Löschen} />, danger: true, onClick: async () => {
        if (!(await confirmDeleteLiveAds(1, 0, ad.title))) return;
        triggerLiveDelete(String(ad.id), toast, refreshAds);
      } });
    } else if (deleteState === 'blocked') {
      items.push({ label: 'Inserat löschen', icon: <Icon paths={ICONS.Löschen} />, danger: true, onClick: async () => {
        if (!(await confirmActivateAndDeleteLiveAd(ad.title))) return;
        activateAndLiveDelete(ad.file, String(ad.id), toast, refreshAds);
      } });
    }
    return items;
  }, [router, allAdsData, updateByFile, toast, refreshAds, runBotCommand, onSaveAsTemplate]);
}
