/** Refresh the access token when it has less than this much lifetime left. */
export const REFRESH_THRESHOLD_MS = 2 * 60 * 1000;

/** Parse the `exp` claim (seconds) from a JWT without verifying the signature. */
export function parseJwtExp(token: string): number {
  try {
    return ((JSON.parse(atob(token.split('.')[1])) as { exp?: number }).exp) ?? 0;
  } catch {
    return 0;
  }
}

/** True when the token expires within REFRESH_THRESHOLD_MS. */
export function isTokenNearExpiry(token: string): boolean {
  return parseJwtExp(token) * 1000 - Date.now() < REFRESH_THRESHOLD_MS;
}
