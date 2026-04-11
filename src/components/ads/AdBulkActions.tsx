'use client';

import { useCallback } from 'react';
import { api } from '@/lib/api/client';
import { useDeleteAdByFile } from '@/hooks/useAds';
import { Button, showConfirm, useToast } from '@/components/ui';
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

  // Map selected file paths to ad objects
  const selectedAds = ads.filter((a) => selectedFiles.has(a.file));
  const publishedAds = selectedAds.filter((a) => !!a.id);
  const draftAds = selectedAds.filter((a) => !a.id);

  const handleBulkPublish = useCallback(async () => {
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
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Fehler beim Veröffentlichen');
      }
    }
    if (publishedAds.length > 0) {
      const ids = publishedAds.map((a) => String(a.id)).join(',');
      try {
        await api.post('/api/bot/publish', { ads: ids });
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Fehler beim Veröffentlichen');
      }
    }
  }, [draftAds, publishedAds, toast]);

  const handleBulkUpdate = useCallback(async () => {
    if (publishedAds.length === 0) {
      toast('error', 'Keine veröffentlichten Anzeigen in der Auswahl');
      return;
    }
    const ids = publishedAds.map((a) => String(a.id)).join(',');
    try {
      await api.post('/api/bot/update', { ads: ids });
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Fehler beim Aktualisieren');
    }
  }, [publishedAds, toast]);

  const handleBulkExtend = useCallback(async () => {
    if (publishedAds.length === 0) {
      toast('error', 'Keine veröffentlichten Anzeigen in der Auswahl');
      return;
    }
    const ids = publishedAds.map((a) => String(a.id)).join(',');
    try {
      await api.post('/api/bot/extend', { ads: ids });
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Fehler beim Verlängern');
    }
  }, [publishedAds, toast]);

  const handleBulkDelete = useCallback(async () => {
    const ok = await showConfirm(
      `${selectedFiles.size} Anzeige(n) entfernen`,
      `Möchtest du ${selectedFiles.size} Anzeige(n) lokal entfernen? Die Dateien werden gelöscht. Bereits veröffentlichte Anzeigen bleiben auf Kleinanzeigen online.`,
      'Entfernen',
      'Abbrechen',
    );
    if (!ok) return;
    const files = Array.from(selectedFiles);
    await Promise.all(files.map((file) => deleteAd.mutateAsync(file)));
    onClear();
  }, [selectedFiles, deleteAd, onClear]);

  const handleBulkDeleteLive = useCallback(async () => {
    if (publishedAds.length === 0) {
      toast('error', 'Keine veröffentlichten Anzeigen in der Auswahl');
      return;
    }
    const confirmed = await showConfirm(
      `${publishedAds.length} Anzeige(n) auf Kleinanzeigen löschen`,
      `Möchtest du ${publishedAds.length} Anzeige(n) auch auf Kleinanzeigen löschen? Diese Aktion kann nicht rückgängig gemacht werden.`,
      'Löschen (Live)',
      'Abbrechen',
    );
    if (!confirmed) return;
    const ids = publishedAds.map((a) => String(a.id)).join(',');
    try {
      await api.post('/api/bot/delete', { ads: ids });
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Fehler beim Löschen');
    }
  }, [publishedAds, toast]);

  if (selectedFiles.size === 0) return null;

  const count = selectedFiles.size;

  return (
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
          <Button variant="danger" size="sm" onClick={handleBulkDelete}>
            Entfernen
          </Button>
          <Button variant="danger" size="sm" onClick={handleBulkDeleteLive}>
            Löschen (Live)
          </Button>
          <Button variant="outline" size="sm" onClick={onClear}>
            Auswahl aufheben
          </Button>
        </div>
      </div>
    </div>
  );
}
