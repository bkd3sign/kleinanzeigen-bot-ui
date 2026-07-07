'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createPortal } from 'react-dom';
import { api } from '@/lib/api/client';
import { useDeleteAdByFile } from '@/hooks/useAds';
import { Button, showConfirm, useToast } from '@/components/ui';
import { confirmRemoveAds } from '@/lib/ads/confirmations';
import { encodeAdFilePath } from '@/lib/ads/paths';
import { AdBulkEditModal } from './AdBulkEditModal';
import type { AdListItem } from '@/types/ad';
import styles from './AdBulkActions.module.scss';

interface AdBulkActionsProps {
  selectedFiles: Set<string>;
  ads: AdListItem[];
  onClear: () => void;
}

export function AdBulkActions({ selectedFiles, ads, onClear }: AdBulkActionsProps) {
  const deleteAd = useDeleteAdByFile();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editModalOpen, setEditModalOpen] = useState(false);

  // Local active/inactive override — survives query refetches and filter changes.
  // Key: file path, Value: active state after a bulk operation.
  const [knownStatus, setKnownStatus] = useState<Map<string, boolean>>(new Map());

  // Reset overrides whenever the selection changes (new selection = fresh slate).
  const selectedFilesKey = useMemo(() => [...selectedFiles].sort().join('|'), [selectedFiles]);
  useEffect(() => { setKnownStatus(new Map()); }, [selectedFilesKey]);

  // Map selected file paths to ad objects
  const selectedAds = ads.filter((a) => selectedFiles.has(a.file));
  const publishedAds = selectedAds.filter((a) => !!a.id);
  const draftAds = selectedAds.filter((a) => !a.id);

  // Derive active/inactive from server data, but prefer local overrides.
  const activeFiles = useMemo(
    () =>
      [...selectedFiles].filter((f) => {
        if (knownStatus.has(f)) return knownStatus.get(f);
        const ad = ads.find((a) => a.file === f);
        return ad ? ad.active !== false : true;
      }),
    [selectedFiles, knownStatus, ads],
  );
  const inactiveFiles = useMemo(
    () => [...selectedFiles].filter((f) => !activeFiles.includes(f)),
    [selectedFiles, activeFiles],
  );
  const handleBulkPublish = useCallback(async () => {
    let started = false;
    if (draftAds.length > 0) {
      const ok = await showConfirm(
        'Alle neuen Anzeigen veröffentlichen',
        `Wichtig: Die Auswahl enthält ${draftAds.length} Entwurf${draftAds.length > 1 ? 'e' : ''} ohne Kleinanzeigen-ID. Alle neuen Anzeigen in deinem Workspace werden veröffentlicht – nicht nur die Auswahl.`,
        'Alle neuen veröffentlichen',
        'Abbrechen',
      );
      if (!ok) return;
      try {
        await api.post('/api/bot/publish', { ads: 'new' });
        started = true;
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Fehler beim Veröffentlichen');
      }
    }
    if (publishedAds.length > 0) {
      const ids = publishedAds.map((a) => String(a.id)).join(',');
      try {
        await api.post('/api/bot/publish', { ads: ids });
        started = true;
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Fehler beim Veröffentlichen');
      }
    }
    if (started) {
      toast('success', 'Veröffentlichung gestartet');
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    }
  }, [draftAds, publishedAds, toast, queryClient]);

  const handleBulkUpdate = useCallback(async () => {
    if (publishedAds.length === 0) {
      toast('error', 'Keine veröffentlichten Anzeigen in der Auswahl');
      return;
    }
    const ids = publishedAds.map((a) => String(a.id)).join(',');
    try {
      await api.post('/api/bot/update', { ads: ids });
      toast('success', 'Aktualisierung gestartet');
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Fehler beim Aktualisieren');
    }
  }, [publishedAds, toast, queryClient]);

  const handleBulkToggleActive = useCallback(async () => {
    // Majority wins: bring all selected to the majority's state.
    // All-active is the exception — it toggles to inactive (no minority to align).
    // Tie goes to inactive (deactivate).
    const goActive = activeFiles.length > 0
      ? inactiveFiles.length > 0 && activeFiles.length > inactiveFiles.length
      : true;
    const toDeactivate = goActive ? [] : activeFiles;
    const toActivate = goActive ? inactiveFiles : [];
    try {
      await Promise.all([
        ...toDeactivate.map((f) =>
          api.put(`/api/ads/by-file/${encodeAdFilePath(f)}`, { active: false }),
        ),
        ...toActivate.map((f) =>
          api.put(`/api/ads/by-file/${encodeAdFilePath(f)}`, { active: true }),
        ),
      ]);
      setKnownStatus((prev) => {
        const m = new Map(prev);
        toDeactivate.forEach((f) => m.set(f, false));
        toActivate.forEach((f) => m.set(f, true));
        return m;
      });
      queryClient.setQueryData<{ ads: AdListItem[]; total: number }>(['ads'], (old) => {
        if (!old) return old;
        const deactivateSet = new Set(toDeactivate);
        const activateSet = new Set(toActivate);
        return {
          ...old,
          ads: old.ads.map((ad) => {
            if (deactivateSet.has(ad.file)) return { ...ad, active: false };
            if (activateSet.has(ad.file)) return { ...ad, active: true };
            return ad;
          }),
        };
      });
      queryClient.invalidateQueries({ queryKey: ['ads'] });
      const msg = toDeactivate.length > 0
        ? `${toDeactivate.length} Anzeige${toDeactivate.length > 1 ? 'n' : ''} deaktiviert`
        : `${toActivate.length} Anzeige${toActivate.length > 1 ? 'n' : ''} aktiviert`;
      toast('success', msg);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Fehler beim Aktivieren/Deaktivieren');
    }
  }, [activeFiles, inactiveFiles, queryClient, toast]);

  const handleBulkDelete = useCallback(async () => {
    const ok = await confirmRemoveAds(selectedFiles.size);
    if (!ok) return;
    const files = Array.from(selectedFiles);
    await Promise.all(files.map((file) => deleteAd.mutateAsync(file)));
    onClear();
  }, [selectedFiles, deleteAd, onClear]);


  if (selectedFiles.size === 0) return null;

  const count = selectedFiles.size;
  const toggleGoActive = activeFiles.length > 0
    ? inactiveFiles.length > 0 && activeFiles.length > inactiveFiles.length
    : true;

  // Portal to document.body so position:fixed works correctly.
  // The AppShell <main> has animPageEnter with transform which breaks fixed positioning.
  return createPortal(
    <>
      <div className={styles.bar}>
        <div className={styles.barInner}>
          <span className={styles.count}>
            {count} Anzeige{count > 1 ? 'n' : ''} ausgewählt
          </span>
          <div className={styles.actions}>
            <Button variant="primary" size="sm" onClick={handleBulkPublish}>
              Veröffentlichen
            </Button>
            <Button variant="outline" size="sm" onClick={handleBulkUpdate}>
              Aktualisieren
            </Button>
            {(activeFiles.length > 0 || inactiveFiles.length > 0) && (
              <Button variant="outline" size="sm" onClick={handleBulkToggleActive}>
                {toggleGoActive ? 'Aktivieren' : 'Deaktivieren'}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setEditModalOpen(true)}>
              Bearbeiten
            </Button>
            <Button variant="outline" size="sm" onClick={handleBulkDelete}>
              Aus Liste entfernen
            </Button>
            <Button variant="outline" size="sm" onClick={onClear}>
              Auswahl aufheben
            </Button>
          </div>
        </div>
      </div>
      <AdBulkEditModal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        onClear={onClear}
        selectedAds={selectedAds}
      />
    </>,
    document.body,
  );
}
