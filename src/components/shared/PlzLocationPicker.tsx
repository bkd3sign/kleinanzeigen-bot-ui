'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Input, Select } from '@/components/ui';
import { api } from '@/lib/api/client';

interface KleinanzeigeLocation {
  id: number;
  name: string;
  zipCode: string;
}

interface PlzLocationPickerProps {
  zipValue: string;
  locationValue: string;
  onZipChange: (zip: string) => void;
  onLocationChange: (location: string) => void;
  disabled?: boolean;
  zipError?: string;
  locationError?: string;
  locationLabel?: ReactNode;
}

export function PlzLocationPicker({
  zipValue,
  locationValue,
  onZipChange,
  onLocationChange,
  disabled = false,
  zipError,
  locationError,
  locationLabel = 'Ort',
}: PlzLocationPickerProps) {
  const [locations, setLocations] = useState<KleinanzeigeLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [noResults, setNoResults] = useState(false);
  const lastFetchedZip = useRef<string>('');

  useEffect(() => {
    const zip = (zipValue ?? '').replace(/\s/g, '');

    if (zip.length !== 5 || !/^\d{5}$/.test(zip)) {
      if (lastFetchedZip.current !== '') {
        setLocations([]);
        setNoResults(false);
        lastFetchedZip.current = '';
      }
      return;
    }

    if (zip === lastFetchedZip.current) return;

    lastFetchedZip.current = zip;
    setLocations([]);
    setNoResults(false);
    setLoading(true);

    const controller = new AbortController();
    // Capture existing value before any async work so we can restore it if valid
    const existingLocation = locationValue;

    api.get<{ locations: KleinanzeigeLocation[] }>(`/api/system/locations?zipCode=${zip}`, controller.signal)
      .then((data) => {
        const locs = data.locations ?? [];
        setLocations(locs);
        setNoResults(locs.length === 0);

        if (locs.length === 1) {
          // Only one option — always auto-select
          onLocationChange(locs[0].name);
        } else if (existingLocation && locs.some((l) => l.name === existingLocation)) {
          // Saved location is valid for this PLZ — keep it (edit mode)
          onLocationChange(existingLocation);
        } else {
          // New PLZ or saved value no longer valid — reset for user to pick
          onLocationChange('');
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    return () => controller.abort();
  // Intentional: only re-fetch when ZIP changes, ignore callback/state refs
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zipValue]);

  const zipComplete = /^\d{5}$/.test((zipValue ?? '').replace(/\s/g, ''));
  const locationOptions = locations.map((l) => ({ value: l.name, label: l.name }));

  return (
    <>
      <Input
        label="PLZ"
        placeholder="z.B. 10115"
        value={zipValue}
        onChange={(e) => onZipChange(e.target.value)}
        disabled={disabled}
        required
        error={zipError}
      />

      {locations.length > 0 ? (
        <Select
          label={locationLabel}
          options={locationOptions}
          value={locationValue}
          onChange={(e) => onLocationChange(e.target.value)}
          disabled={disabled}
          required
          placeholder="Ort auswählen…"
          error={locationError}
        />
      ) : (
        // Always disabled — Ort is exclusively controlled by the PLZ lookup
        <Input
          label={locationLabel}
          placeholder={
            loading
              ? 'Lade Orte…'
              : noResults
                ? 'PLZ unbekannt'
                : 'Zuerst PLZ eingeben'
          }
          value={locationValue}
          disabled
          required
          error={locationError}
        />
      )}
    </>
  );
}
