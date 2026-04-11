'use client';

import { useFormContext } from 'react-hook-form';
import { Input } from '@/components/ui';
import { CollapsibleSection } from './AdForm';
import { LockedBadge } from './InfoTip';
import type { AdCreateInput } from '@/validation/schemas';
import styles from './AdForm.module.scss';

interface ContactSectionProps {
  defaultCollapsed?: boolean;
  locked?: boolean;
}

export function ContactSection({ defaultCollapsed = false, locked = false }: ContactSectionProps) {
  const { register } = useFormContext<AdCreateInput>();

  return (
    <CollapsibleSection
      title="Deine Angaben"
      description="Kontaktdaten die in der Anzeige angezeigt werden."
      defaultCollapsed={defaultCollapsed}
      titleExtra={locked ? <LockedBadge /> : undefined}
    >
      <Input
        label="Name"
        placeholder="Dein Name"
        disabled={locked}
        required
        {...register('contact_name')}
      />

      <Input
        label="Telefon"
        placeholder="Optional"
        disabled={locked}
        {...register('contact_phone')}
      />

      <div className={styles.note}>
        Hinweis: Telefonnummern werden von Kleinanzeigen für private Konten nicht mehr unterstützt.
      </div>
    </CollapsibleSection>
  );
}
