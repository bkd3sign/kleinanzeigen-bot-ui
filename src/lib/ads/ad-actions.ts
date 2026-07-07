import { api } from '@/lib/api/client';
import { encodeAdFilePath } from '@/lib/ads/paths';

type ToastFn = (type: 'success' | 'error' | 'info', message: string) => void;

// Trigger the live deletion of a published ad on Kleinanzeigen. The bot runs the
// deletion asynchronously, so we toast immediately (the job pill appears later).
// Shared by the list and card views so both behave identically.
export function triggerLiveDelete(adId: string, toast: ToastFn, onDone: () => void): void {
  toast('info', 'Löschen gestartet – der Bot entfernt das Inserat, das kann einen Moment dauern.');
  api
    .post('/api/bot/delete', { ads: adId })
    .then(onDone)
    .catch((err) => toast('error', err instanceof Error ? err.message : 'Fehler beim Löschen'));
}

// Activate an inactive-but-still-online ad (e.g. reserved), then live-delete it.
// The bot skips ads with active: false, so we flip the flag first and only
// trigger the deletion once the activation has persisted. Shared by list and
// card views.
export function activateAndLiveDelete(adFile: string, adId: string, toast: ToastFn, onDone: () => void): void {
  const encFile = encodeAdFilePath(adFile);
  api
    .put(`/api/ads/by-file/${encFile}`, { active: true })
    .then(() => triggerLiveDelete(adId, toast, onDone))
    .catch((err) => toast('error', err instanceof Error ? err.message : 'Fehler beim Aktivieren'));
}
