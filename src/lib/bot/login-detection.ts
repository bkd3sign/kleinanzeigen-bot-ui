// Match ONLY the success phrases, never the "Checking if already logged in…"
// (DE: "Überprüfe, ob bereits eingeloggt…") probe line — that probe contains
// "already logged in" / "bereits eingeloggt" and runs on EVERY login, so a loose
// match there would mask every login failure (and hide the VNC-login button).
const LOGGED_IN = [
  /Überspringe Anmeldung/i,   // "Already logged in. Skipping login." (DE)
  /Skipping login/i,          // EN
  /Login confirmed/i,
  /Anmeldung bestätigt/i,
];

// Language-independent diagnostic markers the bot writes on a failed login
// attempt (kleinanzeigen-bot login_flow.py: base_prefix = "login_detection_*").
// These cover every translated Auth0 failure message in one match. Detection-
// ambiguity markers (login_detection_selector_timeout / _inconclusive) are
// intentionally excluded — they are not login-attempt failures.
const LOGIN_FAILED = [
  /login_detection_auth0_flow_failure/,
  /login_detection_sso_navigation_timeout/,
  /_open_logged_in_browser/i,
  // Specific Auth0 failure messages (EN source + observed DE), belt-and-suspenders:
  /Auth0 password step not reached/i,
  /Auth0 password page not reached/i,
  /Auth0-Passwortschritt nicht erreicht/i,
  /Auth0 post-submit verification remained inconclusive/i,
  /Auth0-Verifikation nach Absenden blieb unklar/i,
  /Auth0 redirect not detected/i,
  /Login could not be confirmed after Auth0 flow/i,
  /Anmeldung fehlgeschlagen/i,
];

/** Classify a bot run's output regarding login state. */
export function detectLoginOutcome(output: string): 'logged_in' | 'login_failed' | 'unknown' {
  if (LOGGED_IN.some(r => r.test(output))) return 'logged_in';
  if (LOGIN_FAILED.some(r => r.test(output))) return 'login_failed';
  return 'unknown';
}
