'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal/Modal';
import { Badge } from '@/components/ui/Badge/Badge';
import { useAds } from '@/hooks/useAds';
import { useAiAvailable } from '@/hooks/useAiAvailable';
import { getCurrentPrice } from '@/lib/ads/pricing';
import { api } from '@/lib/api/client';
import styles from './CreateAdModal.module.scss';

interface CreateAdModalProps {
  open: boolean;
  onClose: () => void;
}

// Option card component matching legacy .adCreateModalOption
function ModalOption({
  icon,
  title,
  desc,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className={styles.option}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
    >
      <span className={styles.optionIcon}>{icon}</span>
      <div className={styles.optionText}>
        <div className={styles.optionTitle}>{title}</div>
        <div className={styles.optionDesc}>{desc}</div>
      </div>
    </button>
  );
}

// Duplicate picker sub-modal
function DuplicatePicker({ onClose }: { onClose: () => void }) {
  const { data } = useAds();
  const router = useRouter();
  const [search, setSearch] = useState('');

  const ads = data?.ads ?? [];
  const query = search.toLowerCase();
  const filtered = query
    ? ads.filter((a) => (a.title || '').toLowerCase().includes(query))
    : ads;

  const handleDuplicate = useCallback(
    async (file: string) => {
      try {
        const result = await api.post<{ file: string }>(`/api/ads/duplicate/${file}`);
        onClose();
        router.push(`/ads/edit?file=${encodeURIComponent(result.file)}`);
      } catch {
        // handled by toast
      }
    },
    [onClose, router],
  );

  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  return (
    <Modal open onClose={onClose} title="Anzeige zum Duplizieren wählen">
      <div className={styles.dupPicker}>
        <input
          type="text"
          className={styles.dupSearch}
          placeholder="Anzeige suchen…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <div className={styles.dupList}>
          {filtered.slice(0, 30).map((ad) => {
            const isDraft = !ad.id;
            const imgUrl =
              ad.first_image && ad.file && token
                ? `/api/images/file?file=${encodeURIComponent(ad.file)}&name=${encodeURIComponent(ad.first_image)}&token=${encodeURIComponent(token)}`
                : null;
            return (
              <button
                key={ad.file}
                className={styles.dupItem}
                onClick={() => handleDuplicate(ad.file)}
              >
                {/* Thumbnail */}
                <span className={styles.dupThumb}>
                  {imgUrl ? <img src={imgUrl} alt="" /> : '📷'}
                </span>

                {/* Title + category */}
                <div className={styles.dupInfo}>
                  <div className={styles.dupTitle}>{ad.title || '(Ohne Titel)'}</div>
                  {ad.category && <div className={styles.dupMeta}>{ad.category}</div>}
                </div>

                {/* Status badge */}
                {isDraft ? (
                  <Badge variant="muted">Entwurf</Badge>
                ) : ad.active !== false ? (
                  <Badge variant="success">Aktiv</Badge>
                ) : (
                  <Badge variant="warning">Inaktiv</Badge>
                )}

                {/* Price */}
                <span className={styles.dupPrice}>
                  {ad.price != null ? (() => {
                    const suffix = ad.price_type === 'NEGOTIABLE' ? ' VB' : '';
                    const reduced = getCurrentPrice(ad);
                    if (reduced != null && reduced < ad.price!) {
                      return (
                        <span className={styles.dupPriceReduced}>
                          <span>{reduced} €{suffix}</span>
                          <span className={styles.dupPriceOriginal}>{ad.price} €{suffix}</span>
                        </span>
                      );
                    }
                    return `${ad.price} €${suffix}`;
                  })() : '–'}
                </span>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className={styles.dupEmpty}>Keine Anzeigen gefunden</div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function CreateAdModal({ open, onClose }: CreateAdModalProps) {
  const router = useRouter();
  const { isAiAvailable } = useAiAvailable();
  const [showDupPicker, setShowDupPicker] = useState(false);

  if (showDupPicker) {
    return (
      <DuplicatePicker
        onClose={() => {
          setShowDupPicker(false);
          onClose();
        }}
      />
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Neue Anzeige">
      <div className={styles.grid}>
        <ModalOption
          icon={
            <svg viewBox="0 0 24 24">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          }
          title="Mit KI erstellen"
          desc={isAiAvailable ? 'KI füllt alle Felder automatisch aus.' : 'KI nicht verfügbar — API-Key in config.yaml eintragen.'}
          onClick={() => { onClose(); router.push('/ads/ai'); }}
          disabled={!isAiAvailable}
        />
        <ModalOption
          icon={
            <svg viewBox="0 0 24 24">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          }
          title="Leere Anzeige"
          desc="Alle Felder selbst ausfüllen."
          onClick={() => { onClose(); router.push('/ads/new'); }}
        />
        <ModalOption
          icon={
            <svg viewBox="0 0 24 24">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          }
          title="Aus Vorlage"
          desc="Gespeicherte Vorlage als Basis nutzen."
          onClick={() => { onClose(); router.push('/templates'); }}
        />
        <ModalOption
          icon={
            <svg viewBox="0 0 24 24">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          }
          title="Anzeige duplizieren"
          desc="Bestehende Anzeige als Kopie erstellen."
          onClick={() => setShowDupPicker(true)}
        />
      </div>
    </Modal>
  );
}
