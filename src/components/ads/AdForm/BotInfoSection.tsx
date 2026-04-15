'use client';

import { toLocalISO } from '@/lib/format-date';
import { CollapsibleSection } from './AdForm';
import styles from './AdForm.module.scss';

interface BotInfoSectionProps {
  botInfo: {
    id?: string | number | null;
    created_on?: string | null;
    updated_on?: string | null;
    content_hash?: string | null;
    repost_count?: number | null;
    price_reduction_count?: number | null;
  };
}

const BOT_FIELDS: Array<{ label: string; key: keyof BotInfoSectionProps['botInfo'] }> = [
  { label: 'ID', key: 'id' },
  { label: 'Erstellt am', key: 'created_on' },
  { label: 'Aktualisiert am', key: 'updated_on' },
  { label: 'Content Hash', key: 'content_hash' },
  { label: 'Repost-Zähler', key: 'repost_count' },
  { label: 'Preisreduktion-Zähler', key: 'price_reduction_count' },
];

export function BotInfoSection({ botInfo }: BotInfoSectionProps) {
  return (
    <CollapsibleSection
      title="Bot-Informationen"
      description="Vom Bot verwaltete Felder wie ID, Timestamps und Zähler."
      defaultCollapsed
      isLast
    >
      <div className={styles.botInfoBlock}>
        {BOT_FIELDS.map((field, i) => {
          const value = botInfo[field.key];
          const isLast = i === BOT_FIELDS.length - 1;
          return (
            <div
              key={field.key}
              className={`${styles.botInfoRow} ${!isLast ? styles.botInfoRowBorder : ''}`}
            >
              <span className={styles.botInfoLabel}>{field.label}</span>
              <span className={styles.botInfoValue}>
                {value != null
                  ? (field.key === 'created_on' || field.key === 'updated_on')
                    ? toLocalISO(String(value))
                    : String(value)
                  : '–'}
              </span>
            </div>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}
