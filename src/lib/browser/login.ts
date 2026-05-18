import { type CdpClient, sleep } from './cdp';

export const LOGIN_URL = 'https://www.kleinanzeigen.de/m-einloggen-sso.html';

export const MFA_CODE_INPUT_SELECTOR = `(() => {
  const selectors = ['input[name="code"]', 'input[inputmode="numeric"]', 'input[autocomplete="one-time-code"]', 'input[type="tel"]'];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null) return el;
  }
  return null;
})()`;

const EMAIL_SELECTORS = [
  'input[type="email"]',
  'input[name="username"]',
  'input[name="email"]',
  'input[id="username"]',
  'input[autocomplete="username"]',
  'input[autocomplete="email"]',
];

const PASSWORD_SELECTORS = [
  'input[type="password"]',
  'input[name="password"]',
];

const SUBMIT_SELECTOR = 'button[type="submit"], button[name="action"]';

export type LoginState = 'logged_in' | 'mfa' | 'login_page' | 'unknown';

interface LoginDiagnosticsInput {
  type: string;
  name: string;
  id: string;
  autocomplete: string;
  placeholder: string;
}

interface LoginDiagnostics {
  url: string;
  title: string;
  inputs: LoginDiagnosticsInput[];
  bodySnippet: string;
}

/**
 * Try to dismiss the GDPR consent banner. Never throws.
 */
export async function dismissConsentBanner(cdp: CdpClient): Promise<void> {
  try {
    const dismissed = await cdp.evaluate(`
      (() => {
        const direct = document.querySelector('#gdpr-banner-accept');
        if (direct) { direct.click(); return 'direct'; }
        const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
        const pattern = /alle akzeptieren|akzeptieren|accept all|einverstanden|zustimmen/i;
        for (const btn of buttons) {
          const text = (btn.textContent || '').trim();
          if (text && pattern.test(text)) {
            btn.click();
            return 'fallback';
          }
        }
        return 'none';
      })()
    `);
    if (dismissed === 'direct' || dismissed === 'fallback') {
      await sleep(500);
    }
  } catch {
    // never propagate banner errors
  }
}

/**
 * Fill an input field whose element is returned by `selectorFn` (a JS expression).
 * Uses the native value setter + dispatched events to bypass framework state.
 */
export async function fillInput(cdp: CdpClient, value: string, selectorFn: string): Promise<boolean> {
  const json = JSON.stringify(value);
  const result = await cdp.evaluate(`
    (() => {
      const el = (${selectorFn});
      if (!el) return false;
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value')
        || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      try { el.focus(); } catch (_) { /* fine */ }
      if (desc && desc.set) {
        desc.set.call(el, ${json});
      } else {
        el.value = ${json};
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()
  `);
  return result === true;
}

async function findInputSelector(cdp: CdpClient, selectors: string[]): Promise<string | null> {
  const list = JSON.stringify(selectors);
  const found = await cdp.evaluate(`
    (() => {
      const sels = ${list};
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) return sel;
      }
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (el) return sel;
      }
      return null;
    })()
  `);
  return typeof found === 'string' ? found : null;
}

async function clickSubmit(cdp: CdpClient): Promise<void> {
  await cdp.evaluate(`
    (() => {
      const form = document.querySelector('form');
      const target = (form && form.querySelector(${JSON.stringify(SUBMIT_SELECTOR)}))
        || document.querySelector(${JSON.stringify(SUBMIT_SELECTOR)});
      if (target) target.click();
    })()
  `);
}

async function collectDiagnostics(cdp: CdpClient): Promise<LoginDiagnostics> {
  const raw = await cdp.evaluate(`
    (() => {
      const inputs = Array.from(document.querySelectorAll('input')).map(i => ({
        type: i.type || '',
        name: i.name || '',
        id: i.id || '',
        autocomplete: i.getAttribute('autocomplete') || '',
        placeholder: i.placeholder || '',
      }));
      return JSON.stringify({
        url: window.location.href,
        title: document.title || '',
        inputs,
        bodySnippet: (document.body && document.body.innerText ? document.body.innerText.slice(0, 400) : ''),
      });
    })()
  `);
  if (typeof raw !== 'string') {
    return { url: '', title: '', inputs: [], bodySnippet: '' };
  }
  try {
    return JSON.parse(raw) as LoginDiagnostics;
  } catch {
    return { url: '', title: '', inputs: [], bodySnippet: '' };
  }
}

/**
 * Fill the SSO login form (email then password). Caller is responsible for
 * checking the resulting URL to determine logged_in / mfa / error.
 */
export async function fillLoginForm(
  cdp: CdpClient,
  email: string,
  password: string,
): Promise<{ success: boolean; error?: string; diagnostics?: LoginDiagnostics }> {
  // Step 1: wait up to 15s for an email input to appear
  let emailSelector: string | null = null;
  const emailDeadline = Date.now() + 15000;
  while (Date.now() < emailDeadline) {
    emailSelector = await findInputSelector(cdp, EMAIL_SELECTORS);
    if (emailSelector) break;
    await sleep(250);
  }

  if (!emailSelector) {
    const diagnostics = await collectDiagnostics(cdp);
    return {
      success: false,
      error: 'E-Mail-Feld nicht gefunden',
      diagnostics,
    };
  }

  const emailFilled = await fillInput(cdp, email, `document.querySelector(${JSON.stringify(emailSelector)})`);
  if (!emailFilled) {
    const diagnostics = await collectDiagnostics(cdp);
    return { success: false, error: 'E-Mail-Feld konnte nicht ausgefüllt werden', diagnostics };
  }

  await clickSubmit(cdp);
  await sleep(4000);

  // Step 2: optional password page
  const url = await cdp.evaluate('window.location.href');
  const urlStr = typeof url === 'string' ? url : '';
  const onPasswordPage = urlStr.includes('/u/login/password') || (await findInputSelector(cdp, PASSWORD_SELECTORS)) !== null;

  if (onPasswordPage) {
    const passwordSelector = await findInputSelector(cdp, PASSWORD_SELECTORS);
    if (!passwordSelector) {
      const diagnostics = await collectDiagnostics(cdp);
      return { success: false, error: 'Passwort-Feld nicht gefunden', diagnostics };
    }
    const pwFilled = await fillInput(cdp, password, `document.querySelector(${JSON.stringify(passwordSelector)})`);
    if (!pwFilled) {
      const diagnostics = await collectDiagnostics(cdp);
      return { success: false, error: 'Passwort-Feld konnte nicht ausgefüllt werden', diagnostics };
    }
    await clickSubmit(cdp);
    await sleep(6000);
  }

  return { success: true };
}

/**
 * Inspect the current URL to classify the login state.
 */
export async function detectLoginState(cdp: CdpClient): Promise<LoginState> {
  const url = await cdp.evaluate('window.location.href');
  const urlStr = typeof url === 'string' ? url : '';
  const lower = urlStr.toLowerCase();

  if (lower.includes('mfa') || lower.includes('challenge') || lower.includes('verification')) {
    return 'mfa';
  }
  if (lower.includes('login.kleinanzeigen.de') || lower.includes('m-einloggen')) {
    return 'login_page';
  }
  if (lower.includes('kleinanzeigen.de')) {
    return 'logged_in';
  }
  return 'unknown';
}
