import { describe, it, expect } from 'vitest';
import { detectLoginOutcome } from '../login-detection';

describe('detectLoginOutcome', () => {
  it('logged_in on skip-login marker', () => {
    expect(detectLoginOutcome('[INFO] Bereits eingeloggt. Überspringe Anmeldung.')).toBe('logged_in');
    expect(detectLoginOutcome('[INFO] Already logged in. Skipping login.')).toBe('logged_in');
  });
  it('logged_in on login-confirmed marker', () => {
    expect(detectLoginOutcome('[INFO] Login confirmed.')).toBe('logged_in');
    expect(detectLoginOutcome('[INFO] Anmeldung bestätigt.')).toBe('logged_in');
  });
  it('login_failed on Auth0/login failure messages', () => {
    expect(detectLoginOutcome('AssertionError: Auth0-Passwortschritt nicht erreicht (URL=...)')).toBe('login_failed');
    expect(detectLoginOutcome('TimeoutError: Auth0 password page not reached within 12.0 seconds')).toBe('login_failed');
    expect(detectLoginOutcome('_open_logged_in_browser')).toBe('login_failed');
    // post-submit-inconclusive (observed live, DE + EN)
    expect(detectLoginOutcome('TimeoutError: Auth0-Verifikation nach Absenden blieb unklar (URL=...)')).toBe('login_failed');
    expect(detectLoginOutcome('Auth0 post-submit verification remained inconclusive (url=...)')).toBe('login_failed');
  });
  it('login_failed via language-independent diagnostic marker (covers all translations)', () => {
    expect(detectLoginOutcome('[INFO] Diagnosedaten gespeichert: /ws/.temp/diagnostics/login_detection_auth0_flow_failure_20260623T163801_d7c16901.png')).toBe('login_failed');
    expect(detectLoginOutcome('login_detection_sso_navigation_timeout_x.log')).toBe('login_failed');
  });
  it('regression: the "Checking if already logged in" probe line must NOT mask a failure', () => {
    // The bot logs this probe on EVERY run; it contains "bereits eingeloggt" / "already
    // logged in" but is NOT a success. A real failed run includes it + the failure marker.
    const realFailedRun = [
      '[INFO] Überprüfe, ob bereits eingeloggt...',
      '[INFO] Anmeldung...',
      '[INFO] Diagnosedaten gespeichert: /ws/.temp/diagnostics/login_detection_auth0_flow_failure_x.png',
      '[FEHLER] TimeoutError: Auth0-Verifikation nach Absenden blieb unklar (URL=https://login.kleinanzeigen.de/u/login/password)',
    ].join('\n');
    expect(detectLoginOutcome(realFailedRun)).toBe('login_failed');
    expect(detectLoginOutcome('[INFO] Überprüfe, ob bereits eingeloggt...')).toBe('unknown');
    expect(detectLoginOutcome('[INFO] Checking if already logged in...')).toBe('unknown');
  });
  it('unknown otherwise — incl. detection-ambiguity markers (not login-attempt failures)', () => {
    expect(detectLoginOutcome('[INFO] 3 Bilder heruntergeladen.')).toBe('unknown');
    expect(detectLoginOutcome('login_detection_selector_timeout_x.log')).toBe('unknown');
  });
});
