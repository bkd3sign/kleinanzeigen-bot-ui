/**
 * Heuristic: is the VNC browser on a logged-in Kleinanzeigen page?
 *
 * The VNC session starts on a protected page ("Meine Anzeigen"). If not logged in,
 * Kleinanzeigen redirects into the login flow (m-einloggen → Auth0 SSO on
 * login.kleinanzeigen.de); once the browser is on a normal kleinanzeigen.de page,
 * the session is active. Conservative by design: anything still inside the
 * login/SSO flow (or off-domain) counts as "not yet".
 */
export function isLoggedInUrl(url: string): boolean {
  if (!url || !/kleinanzeigen\.de/i.test(url)) return false;
  // Still inside the login / Auth0 SSO flow → not logged in yet.
  if (/login\.kleinanzeigen\.de/i.test(url)) return false;
  if (/m-einloggen/i.test(url)) return false;
  if (/\/u\/login|\/authorize|\/sso|auth0/i.test(url)) return false;
  return true;
}
