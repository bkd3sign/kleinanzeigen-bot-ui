'use client';

import { useFormContext } from 'react-hook-form';
import { Input } from '@/components/ui';
import { PlzLocationPicker } from '@/components/shared/PlzLocationPicker';
import { CollapsibleSection } from './AdForm';
import { LockedBadge } from './InfoTip';
import type { AdCreateInput } from '@/validation/schemas';
import styles from './AdForm.module.scss';

interface LocationSectionProps {
  defaultCollapsed?: boolean;
  locked?: boolean;
}

export function LocationSection({ defaultCollapsed = false, locked = false }: LocationSectionProps) {
  const { register, watch, setValue, formState: { errors } } = useFormContext<AdCreateInput>();

  return (
    <CollapsibleSection
      title="Ort"
      description="Standort der Anzeige."
      defaultCollapsed={defaultCollapsed}
      titleExtra={locked ? <LockedBadge /> : undefined}
    >
      <div className={styles.row}>
        <PlzLocationPicker
          zipValue={watch('contact_zipcode') ?? ''}
          locationValue={watch('contact_location') ?? ''}
          onZipChange={(v) => setValue('contact_zipcode', v, { shouldValidate: true })}
          onLocationChange={(v) => setValue('contact_location', v, { shouldValidate: true })}
          disabled={locked}
          zipError={errors.contact_zipcode?.message}
          locationError={errors.contact_location?.message}
        />
      </div>

      <Input
        label="Straße/Nr."
        placeholder="Optional"
        disabled={locked}
        {...register('contact_street')}
      />

      <div className={styles.tip}>
        Tipp: Standardmäßig zeigen wir nur die Postleitzahl und den Ort an.
      </div>
    </CollapsibleSection>
  );
}
