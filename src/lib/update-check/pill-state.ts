// Shared shape of the GUI update-check endpoint response (used by the endpoint
// and the About modal, which needs currentVersion/releaseUrl for its link).
export interface GuiUpdateResult {
  upToDate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
}

// localStorage keys (per device).
export const UPDATE_CHECK_DATE_KEY = 'update-check-date';
export const UPDATE_CHECK_RESULT_KEY = 'update-check-result';
export const UPDATE_CHECK_DISMISSED_KEY = 'update-check-dismissed';

// Fallback when NEXT_PUBLIC_APP_VERSION is not inlined. Shared by the endpoint
// and the client hook so both compare against the same sentinel.
export const FALLBACK_VERSION = '0.0.0';

// Matches a plain MAJOR.MINOR.PATCH version (what our releases use).
const VERSION_RE = /^\d+\.\d+\.\d+$/;

// Parse one version segment; non-numeric parts (e.g. a "-beta" suffix) count
// as 0 so the comparison never produces NaN (which would silently read as
// "up to date" and hide the pill).
function segment(part: string | undefined): number {
  const n = parseInt(part ?? '', 10);
  return Number.isNaN(n) ? 0 : n;
}

// True when `current` is at or above `latest` (dotted MAJOR.MINOR.PATCH).
// Shared by the server endpoint and the client pill so both agree on "up to date".
export function isVersionUpToDate(current: string, latest: string): boolean {
  const c = current.split('.');
  const l = latest.split('.');
  for (let i = 0; i < 3; i++) {
    const cs = segment(c[i]);
    const ls = segment(l[i]);
    if (cs > ls) return true;
    if (cs < ls) return false;
  }
  return true;
}

// Format a date as a LOCAL YYYY-MM-DD stamp used to throttle checks to once per
// day. Uses local calendar parts (not toISOString, which is UTC) so the day
// boundary matches the admin's timezone.
export function todayStamp(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// A check is due when it has not run yet today.
export function shouldCheckToday(lastCheck: string | null, today: string): boolean {
  return lastCheck !== today;
}

// The pill shows only when the latest release is newer than the running app AND
// that exact version was not dismissed. Comparing against the live app version
// (not a cached upToDate flag) makes the pill self-heal right after an update
// instead of lingering until the next daily check.
export function shouldShowPill(
  latestVersion: string | null,
  dismissedVersion: string | null,
  currentVersion: string,
): boolean {
  if (!latestVersion) return false;
  if (isVersionUpToDate(currentVersion, latestVersion)) return false;
  return latestVersion !== dismissedVersion;
}

// Read the cached latest version; returns null unless it is a well-formed
// MAJOR.MINOR.PATCH string. This rejects a stale old-format JSON cache and any
// corrupted value, so they never reach the version comparison.
export function parseStoredVersion(raw: string | null): string | null {
  return raw && VERSION_RE.test(raw) ? raw : null;
}
