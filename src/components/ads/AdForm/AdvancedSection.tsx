'use client';

import { useFormContext } from 'react-hook-form';
import { Textarea } from '@/components/ui';
import { CollapsibleSection } from './AdForm';
import { InfoTip, LockedBadge, withLocked } from './InfoTip';
import type { AdCreateInput } from '@/validation/schemas';

interface AdvancedSectionProps {
  lockedFields?: string[];
}

export function AdvancedSection({ lockedFields }: AdvancedSectionProps) {
  const { register } = useFormContext<AdCreateInput>();
  const isLocked = (field: string) => lockedFields?.includes(field) ?? false;
  const hasLockedFields = ['description_prefix', 'description_suffix']
    .some((f) => isLocked(f));

  return (
    <CollapsibleSection
      title="Anzeigen Prefixe"
      description="Text, der automatisch vor oder nach jeder Anzeigenbeschreibung eingefügt wird."
      defaultCollapsed={!hasLockedFields}
      titleExtra={hasLockedFields ? <LockedBadge /> : undefined}
    >
      <Textarea
        label={withLocked(<>Beschreibungs-Prefix <InfoTip text="Text, der vor jeder Anzeigenbeschreibung eingefügt wird" /></>, isLocked('description_prefix'))}
        placeholder="Text vor der Beschreibung…"
        rows={3}
        disabled={isLocked('description_prefix')}
        {...register('description_prefix')}
      />
      <Textarea
        label={withLocked(<>Beschreibungs-Suffix <InfoTip text="Text, der nach jeder Anzeigenbeschreibung eingefügt wird" /></>, isLocked('description_suffix'))}
        placeholder="Text nach der Beschreibung…"
        rows={3}
        disabled={isLocked('description_suffix')}
        {...register('description_suffix')}
      />
    </CollapsibleSection>
  );
}
