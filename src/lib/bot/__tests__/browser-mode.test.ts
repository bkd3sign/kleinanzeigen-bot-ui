import { describe, it, expect, afterEach } from 'vitest';
import { resolveBrowserMode, buildBrowserConfig, hasNativeDisplay, isVncAttachMode, isAttachRun } from '../browser-mode';

describe('resolveBrowserMode', () => {
  it('defaults to auto when unset/invalid', () => {
    expect(resolveBrowserMode({})).toBe('auto');
    expect(resolveBrowserMode({ browser: { mode: 'nonsense' } })).toBe('auto');
  });
  it('reads browser.mode', () => {
    expect(resolveBrowserMode({ browser: { mode: 'headless' } })).toBe('headless');
    expect(resolveBrowserMode({ browser: { mode: 'visible' } })).toBe('visible');
  });
});

describe('buildBrowserConfig', () => {
  const base = ['--no-sandbox', '--disable-dev-shm-usage'];
  it('headless: adds --headless=new + profile, no remote-debugging', () => {
    const c = buildBrowserConfig({ mode: 'headless', profilePath: '/w/.temp/browser-profile', baseArguments: base });
    expect(c.arguments).toContain('--headless=new');
    expect(c.arguments).toContain('--user-data-dir=/w/.temp/browser-profile');
    expect(c.arguments.some(a => a.startsWith('--remote-debugging-port='))).toBe(false);
    expect(c.user_data_dir).toBe('/w/.temp/browser-profile');
    expect(c.use_private_window).toBe(false);
  });
  it('auto behaves like headless for the bot run (escalation is runner-side)', () => {
    const c = buildBrowserConfig({ mode: 'auto', profilePath: '/w/p', baseArguments: base });
    expect(c.arguments).toContain('--headless=new');
  });
  it('visible: attach via --remote-debugging-port + matching user-data-dir, no --headless', () => {
    const c = buildBrowserConfig({ mode: 'visible', profilePath: '/w/p', attachPort: 9300, baseArguments: base });
    expect(c.arguments).toContain('--remote-debugging-port=9300');
    expect(c.arguments).toContain('--remote-debugging-host=127.0.0.1');
    expect(c.arguments).toContain('--user-data-dir=/w/p');
    expect(c.arguments).not.toContain('--headless=new');
  });
  it('visible + nativeVisible: real desktop window — user-data-dir, no --headless, no remote-debugging', () => {
    const c = buildBrowserConfig({ mode: 'visible', profilePath: '/w/p', nativeVisible: true, baseArguments: base });
    expect(c.arguments).toContain('--user-data-dir=/w/p');
    expect(c.arguments).not.toContain('--headless=new');
    expect(c.arguments.some(a => a.startsWith('--remote-debugging-port='))).toBe(false);
  });
  it('attachPort wins over nativeVisible (VNC attach on a server that also has a display)', () => {
    const c = buildBrowserConfig({ mode: 'visible', profilePath: '/w/p', attachPort: 9300, nativeVisible: true, baseArguments: base });
    expect(c.arguments).toContain('--remote-debugging-port=9300');
    expect(c.arguments).not.toContain('--headless=new');
  });
  it('visible with port 0: still produces remote-debugging args, not headless', () => {
    const c = buildBrowserConfig({ mode: 'visible', profilePath: '/w/p', attachPort: 0, baseArguments: base });
    expect(c.arguments).toContain('--remote-debugging-port=0');
    expect(c.arguments).not.toContain('--headless=new');
  });
  // Regression: a forceVisible AUTO retry sets attachPort but keeps mode='auto'. It MUST attach,
  // not launch a second --headless browser on the shared profile (which collided with the VNC
  // browser → "Failed to connect to browser").
  it('auto mode WITH attachPort (forceVisible retry): attaches, never headless', () => {
    const c = buildBrowserConfig({ mode: 'auto', profilePath: '/w/p', attachPort: 9300, baseArguments: base });
    expect(c.arguments).toContain('--remote-debugging-port=9300');
    expect(c.arguments).toContain('--remote-debugging-host=127.0.0.1');
    expect(c.arguments).not.toContain('--headless=new');
  });
  it('auto mode WITHOUT attachPort: headless as before', () => {
    const c = buildBrowserConfig({ mode: 'auto', profilePath: '/w/p', baseArguments: base });
    expect(c.arguments).toContain('--headless=new');
    expect(c.arguments.some(a => a.startsWith('--remote-debugging-port='))).toBe(false);
  });
  it('does not duplicate base args', () => {
    const c = buildBrowserConfig({ mode: 'headless', profilePath: '/w/p', baseArguments: ['--no-sandbox'] });
    expect(c.arguments.filter(a => a === '--no-sandbox')).toHaveLength(1);
  });
});

describe('hasNativeDisplay', () => {
  const origPlatform = process.platform;
  const origDisplay = process.env.DISPLAY;
  const setPlatform = (p: NodeJS.Platform) => Object.defineProperty(process, 'platform', { value: p, configurable: true });
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    if (origDisplay === undefined) delete process.env.DISPLAY;
    else process.env.DISPLAY = origDisplay;
  });
  it('true on macOS/Windows regardless of DISPLAY', () => {
    delete process.env.DISPLAY;
    setPlatform('darwin');
    expect(hasNativeDisplay()).toBe(true);
    setPlatform('win32');
    expect(hasNativeDisplay()).toBe(true);
  });
  it('Linux: only with an X DISPLAY set (headless server/Docker → false)', () => {
    setPlatform('linux');
    delete process.env.DISPLAY;
    expect(hasNativeDisplay()).toBe(false);
    process.env.DISPLAY = ':0';
    expect(hasNativeDisplay()).toBe(true);
  });
});

describe('isVncAttachMode', () => {
  const origPlatform = process.platform;
  const origDisplay = process.env.DISPLAY;
  const setPlatform = (p: NodeJS.Platform) => Object.defineProperty(process, 'platform', { value: p, configurable: true });
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    if (origDisplay === undefined) delete process.env.DISPLAY;
    else process.env.DISPLAY = origDisplay;
  });

  it('true only for visible mode on a headless server (Docker/NAS: no DISPLAY)', () => {
    setPlatform('linux');
    delete process.env.DISPLAY;
    expect(isVncAttachMode('visible')).toBe(true);
  });

  it('false for headless and auto regardless of platform (own browser, normal cleanup applies)', () => {
    setPlatform('linux');
    delete process.env.DISPLAY;
    expect(isVncAttachMode('headless')).toBe(false);
    expect(isVncAttachMode('auto')).toBe(false);
  });

  it('false for visible on a desktop with a real display (native window, not attach)', () => {
    setPlatform('linux');
    process.env.DISPLAY = ':0';
    expect(isVncAttachMode('visible')).toBe(false);
    setPlatform('darwin');
    delete process.env.DISPLAY;
    expect(isVncAttachMode('visible')).toBe(false);
  });
});

describe('isAttachRun', () => {
  const origPlatform = process.platform;
  const origDisplay = process.env.DISPLAY;
  const setPlatform = (p: NodeJS.Platform) => Object.defineProperty(process, 'platform', { value: p, configurable: true });
  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    if (origDisplay === undefined) delete process.env.DISPLAY;
    else process.env.DISPLAY = origDisplay;
  });

  it('true when forceVisible, regardless of mode (AUTO retry attaches to VNC)', () => {
    setPlatform('linux');
    delete process.env.DISPLAY;
    expect(isAttachRun('auto', true)).toBe(true);
    expect(isAttachRun('headless', true)).toBe(true);
  });

  it('true for visible mode on a headless server even without forceVisible', () => {
    setPlatform('linux');
    delete process.env.DISPLAY;
    expect(isAttachRun('visible', false)).toBe(true);
  });

  it('false for headless/auto without forceVisible (own browser)', () => {
    setPlatform('linux');
    delete process.env.DISPLAY;
    expect(isAttachRun('auto', false)).toBe(false);
    expect(isAttachRun('headless', false)).toBe(false);
  });
});
