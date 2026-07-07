import { describe, it, expect } from 'vitest';
import { isLoggedInUrl } from '../login-url';

describe('isLoggedInUrl', () => {
  it('is false while still in the login / Auth0 flow', () => {
    expect(isLoggedInUrl('https://www.kleinanzeigen.de/m-einloggen.html')).toBe(false);
    // The VNC start page (SSO login) must count as "not logged in" until KA redirects away.
    expect(isLoggedInUrl('https://www.kleinanzeigen.de/m-einloggen-sso.html')).toBe(false);
    expect(isLoggedInUrl('https://login.kleinanzeigen.de/u/login/password')).toBe(false);
    expect(isLoggedInUrl('https://login.kleinanzeigen.de/authorize?client_id=x')).toBe(false);
  });

  it('is true on a normal kleinanzeigen.de page (login left behind)', () => {
    expect(isLoggedInUrl('https://www.kleinanzeigen.de/')).toBe(true);
    expect(isLoggedInUrl('https://www.kleinanzeigen.de/m-meine-anzeigen.html')).toBe(true);
    expect(isLoggedInUrl('https://www.kleinanzeigen.de/s-anzeige/foo/123')).toBe(true);
  });

  it('is false for off-domain, blank, or empty URLs', () => {
    expect(isLoggedInUrl('about:blank')).toBe(false);
    expect(isLoggedInUrl('https://accounts.google.com/')).toBe(false);
    expect(isLoggedInUrl('')).toBe(false);
  });
});
