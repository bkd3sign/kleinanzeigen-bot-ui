import type { CdpClient } from './cdp';

export const STEALTH_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

/**
 * Chrome flags for anti-detection. Caller must add --headless / --no-sandbox /
 * --remote-debugging-port / --user-data-dir / --disable-gpu themselves.
 */
export const STEALTH_ARGS: string[] = [
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process,AutomationControlled',
  '--no-first-run',
  '--no-default-browser-check',
  '--no-service-autorun',
  '--lang=de-DE',
  '--window-size=1920,1080',
  `--user-agent=${STEALTH_UA}`,
  '--disable-crash-reporter',
  '--disable-sync',
  '--password-store=basic',
  '--disable-breakpad',
  '--disable-dev-shm-usage',
  '--disable-session-crashed-bubble',
  '--disable-search-engine-choice-screen',
  '--remote-allow-origins=*',
];

const STEALTH_PATCH_SOURCE = `(() => {
  try {
    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => undefined, configurable: true });
    Object.defineProperty(Navigator.prototype, 'languages', { get: () => ['de-DE', 'de', 'en-US', 'en'], configurable: true });
    Object.defineProperty(Navigator.prototype, 'plugins', {
      get: () => {
        const arr = [1,2,3,4,5].map(() => ({}));
        Object.defineProperty(arr, 'length', { get: () => 5 });
        return arr;
      },
      configurable: true,
    });
    if (!window.chrome) {
      Object.defineProperty(window, 'chrome', { value: { runtime: {}, app: {}, csi: () => {}, loadTimes: () => {} }, configurable: true });
    } else if (!window.chrome.runtime) {
      window.chrome.runtime = {};
    }
    const origQuery = window.navigator.permissions && window.navigator.permissions.query;
    if (origQuery) {
      window.navigator.permissions.query = (parameters) =>
        parameters && parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission === 'denied' ? 'prompt' : Notification.permission })
          : origQuery.call(window.navigator.permissions, parameters);
    }
    const getParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(param) {
      if (param === 37445) return 'Intel Inc.';
      if (param === 37446) return 'Intel Iris OpenGL Engine';
      return getParam.call(this, param);
    };
  } catch (_) { /* never throw inside stealth */ }
})();`;

/**
 * Inject stealth patches into every new document via Page.addScriptToEvaluateOnNewDocument.
 * Must be called after Page.enable + Runtime.enable but before the first navigation.
 */
export async function injectStealthScript(cdp: CdpClient): Promise<void> {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: STEALTH_PATCH_SOURCE });
}
