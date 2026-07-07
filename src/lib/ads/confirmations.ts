import { showConfirm } from '@/components/ui';

// Single source of truth for destructive ad-action confirmations, so the bulk
// multi-select, the danger-zone bulk-edit and the single per-ad actions
// (list + card view) all show the same modal with the same wording.
//
// Two distinct vocabularies make the actions unmistakable:
//   - local removal -> "Anzeige" / "aus der Liste" (neutral)
//   - live deletion -> "Inserat" / "auf Kleinanzeigen" (red danger button)

const anzeige = (count: number): string => `${count} Anzeige${count !== 1 ? 'n' : ''}`;
const inserat = (count: number): string => `${count} Inserat${count !== 1 ? 'e' : ''}`;
// Single-ad actions name the ad in German quotes (per CLAUDE.md confirmation convention).
const named = (title?: string): string => `„${title?.trim() || '(Ohne Titel)'}"`;

// Local removal — deletes the local files. Published listings stay online on Kleinanzeigen.
// Pass `title` for the single-ad case so the ad is named instead of counted.
export function confirmRemoveAds(count: number, title?: string): Promise<boolean> {
  if (count === 1 && title !== undefined) {
    return showConfirm(
      'Anzeige aus der Liste entfernen',
      `Möchtest du ${named(title)} aus deiner Liste entfernen? Die Datei wird gelöscht. Ein bereits veröffentlichtes Inserat bleibt auf Kleinanzeigen online.`,
      'Entfernen',
      'Abbrechen',
    );
  }
  return showConfirm(
    `${anzeige(count)} aus der Liste entfernen`,
    `Möchtest du ${anzeige(count)} aus deiner Liste entfernen? Die Dateien werden gelöscht. Bereits veröffentlichte Inserate bleiben auf Kleinanzeigen online.`,
    'Entfernen',
    'Abbrechen',
  );
}

// Live deletion — removes the published listing on Kleinanzeigen. Cannot be undone.
// Pass `title` for the single-ad case so the ad is named instead of counted.
// `skipped` (bulk only) names how many selected listings are excluded because
// the bot would skip them (inactive or no longer online).
export function confirmDeleteLiveAds(count: number, skipped = 0, title?: string): Promise<boolean> {
  if (count === 1 && title !== undefined) {
    return showConfirm(
      'Inserat auf Kleinanzeigen löschen',
      `Möchtest du ${named(title)} dauerhaft auf Kleinanzeigen löschen? Diese Aktion kann nicht rückgängig gemacht werden.`,
      'Löschen',
      'Abbrechen',
      undefined,
      'dangerSolid', // solid red button — irreversible online deletion
    );
  }
  const skipNote = skipped > 0
    ? ` ${skipped} weitere ${skipped === 1 ? 'Anzeige wird' : 'Anzeigen werden'} übersprungen (inaktiv oder nicht mehr online).`
    : '';
  return showConfirm(
    `${inserat(count)} auf Kleinanzeigen löschen`,
    `Möchtest du ${inserat(count)} dauerhaft auf Kleinanzeigen löschen? Diese Aktion kann nicht rückgängig gemacht werden.${skipNote}`,
    'Löschen',
    'Abbrechen',
    undefined,
    'dangerSolid', // solid red button — irreversible online deletion
  );
}

// Activate-and-delete — same wording as a normal live deletion, with a short
// note that the listing is currently reserved/inactive and will be reactivated
// for the deletion (the bot skips inactive ads). Pass `title` to name the ad.
export function confirmActivateAndDeleteLiveAd(title?: string): Promise<boolean> {
  const subject = title !== undefined ? named(title) : 'dieses Inserat';
  return showConfirm(
    'Reserviertes Inserat löschen',
    `Möchtest du ${subject} dauerhaft auf Kleinanzeigen löschen? Die Anzeige ist aktuell reserviert oder inaktiv und wird dafür kurz aktiviert. Diese Aktion kann nicht rückgängig gemacht werden.`,
    'Aktivieren & löschen',
    'Abbrechen',
    undefined,
    'dangerSolid', // solid red button — irreversible online deletion
  );
}
