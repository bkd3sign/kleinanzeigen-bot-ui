'use client';

import { useCallback, useState } from 'react';
import { Modal, Input, Button, useToast } from '@/components/ui';
import { api } from '@/lib/api/client';
import type { Job } from '@/types/bot';
import styles from './DownloadModal.module.scss';

interface DownloadModalProps {
  open: boolean;
  onClose: () => void;
}

export function DownloadModal({ open, onClose }: DownloadModalProps) {
  const { toast } = useToast();
  const [showIds, setShowIds] = useState(false);
  const [ids, setIds] = useState('');

  const startDownload = useCallback(async (ads: string) => {
    onClose();
    setShowIds(false);
    setIds('');
    try {
      await api.post<Job>('/api/bot/download', { ads });
      toast('success', 'Download gestartet');
    } catch {
      toast('error', 'Fehler beim Starten');
    }
  }, [onClose, toast]);

  const handleIdsSubmit = useCallback(() => {
    const trimmed = ids.trim();
    if (!trimmed) {
      toast('error', 'Bitte IDs eingeben');
      return;
    }
    startDownload(trimmed);
  }, [ids, startDownload, toast]);

  if (showIds) {
    return (
      <Modal open={open} onClose={() => { setShowIds(false); onClose(); }} title="Live Backup – IDs" footer={
        <div className={styles.footer}>
          <Button variant="secondary" onClick={() => setShowIds(false)}>Zurück</Button>
          <Button variant="primary" onClick={handleIdsSubmit}>Backup starten</Button>
        </div>
      }>
        <div className={styles.idsForm}>
          <p className={styles.idsDesc}>
            Gib die Anzeigen-IDs ein, die du herunterladen möchtest (kommagetrennt).
          </p>
          <Input
            placeholder="z.B. 12345, 67890"
            value={ids}
            onChange={(e) => setIds(e.target.value)}
            autoFocus
          />
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Live Backup">
      <div className={styles.grid}>
        <button className={styles.option} onClick={() => startDownload('new')}>
          <span className={styles.optionIcon}>
            <svg viewBox="0 0 24 24">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </span>
          <div className={styles.optionText}>
            <div className={styles.optionTitle}>Neue Anzeigen</div>
            <div className={styles.optionDesc}>Nur Anzeigen herunterladen, die noch nicht lokal vorhanden sind.</div>
          </div>
        </button>

        <button className={styles.option} onClick={() => startDownload('all')}>
          <span className={styles.optionIcon}>
            <svg viewBox="0 0 24 24">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="7.5 4.21 12 6.81 16.5 4.21" />
              <polyline points="7.5 19.79 7.5 14.6 3 12" />
              <polyline points="21 12 16.5 14.6 16.5 19.79" />
              <line x1="12" y1="22" x2="12" y2="12" />
            </svg>
          </span>
          <div className={styles.optionText}>
            <div className={styles.optionTitle}>Alle Anzeigen</div>
            <div className={styles.optionDesc}>Alle Anzeigen von Kleinanzeigen herunterladen.</div>
          </div>
        </button>

        <button className={styles.option} onClick={() => setShowIds(true)}>
          <span className={styles.optionIcon}>
            <svg viewBox="0 0 24 24">
              <line x1="4" y1="9" x2="20" y2="9" />
              <line x1="4" y1="15" x2="20" y2="15" />
              <line x1="10" y1="3" x2="8" y2="21" />
              <line x1="16" y1="3" x2="14" y2="21" />
            </svg>
          </span>
          <div className={styles.optionText}>
            <div className={styles.optionTitle}>Bestimmte IDs</div>
            <div className={styles.optionDesc}>Nur bestimmte Anzeigen-IDs herunterladen.</div>
          </div>
        </button>
      </div>
    </Modal>
  );
}
