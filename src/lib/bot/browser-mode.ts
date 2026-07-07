export type BrowserMode = 'auto' | 'headless' | 'visible';

const VALID: ReadonlySet<string> = new Set(['auto', 'headless', 'visible']);

/** Read browser.mode from a (merged) config; default 'auto'. */
export function resolveBrowserMode(config: Record<string, unknown>): BrowserMode {
  const browser = (config?.browser ?? {}) as Record<string, unknown>;
  const mode = typeof browser.mode === 'string' ? browser.mode : '';
  return (VALID.has(mode) ? mode : 'auto') as BrowserMode;
}

/**
 * Whether the host has a real display the bot can open a visible browser window on:
 * desktop OS (macOS/Windows) always, Linux only with an X DISPLAY. Headless servers and
 * Docker have none → visible mode uses the Xvnc/noVNC path instead.
 */
export function hasNativeDisplay(): boolean {
  if (process.platform === 'darwin' || process.platform === 'win32') return true;
  return !!process.env.DISPLAY;
}

/**
 * Whether the bot ATTACHES to a running Xvnc/noVNC browser instead of launching its own.
 * True only for visible mode on a headless server (no native display) — there the VNC
 * browser owns the shared profile on purpose, so the queue must NOT free the profile,
 * clear its locks, or wipe it on retry (all of which would break the attach).
 * Headless/auto, and visible-on-desktop, launch their own browser → this is false and the
 * normal clean-profile preparation applies unchanged.
 */
export function isVncAttachMode(mode: BrowserMode): boolean {
  return mode === 'visible' && !hasNativeDisplay();
}

/**
 * Whether a specific RUN attaches to the VNC browser instead of launching its own — the
 * single source of truth for that decision. True when the run is forced visible (AUTO retry
 * after login_required) OR the configured mode attaches (visible on a headless server).
 * Both the queue (to skip the profile teardown that would kill the VNC browser) and the
 * runner (to actually attach) must agree on this, so they call the same predicate rather
 * than each re-deriving it.
 */
export function isAttachRun(mode: BrowserMode, forceVisible: boolean): boolean {
  return forceVisible || isVncAttachMode(mode);
}

interface BuildOpts {
  mode: BrowserMode;
  profilePath: string;
  attachPort?: number;
  /** Desktop visible mode: launch a real non-headless window (no Xvnc, no attach). */
  nativeVisible?: boolean;
  baseArguments: string[];
}

/**
 * Build the effective browser config block for the bot.
 * - headless/auto: own headless browser on the shared login profile.
 * - visible + attachPort: connect to a running (Xvnc/noVNC) browser via remote debugging.
 * - visible + nativeVisible: launch a real visible window on the host display (desktop).
 * Documented Chrome 136+ requirement: --user-data-dir must accompany --remote-debugging-port.
 */
export function buildBrowserConfig(opts: BuildOpts): { arguments: string[]; user_data_dir: string; use_private_window: boolean } {
  const { mode, profilePath, attachPort, nativeVisible, baseArguments } = opts;
  const args = baseArguments.filter(
    a => !a.startsWith('--headless') && !a.startsWith('--remote-debugging-port=') &&
         !a.startsWith('--remote-debugging-host=') && !a.startsWith('--user-data-dir='),
  );
  if (attachPort !== undefined) {
    // Attach to the running (Xvnc/noVNC) browser via remote debugging. attachPort is set by
    // the runner ONLY when it has decided to attach — visible mode on a headless server, OR a
    // forceVisible AUTO retry. Must NOT also require mode === 'visible' here: a forceVisible
    // retry runs with mode === 'auto' but still needs to attach. Gating on mode launched a
    // second --headless browser on the shared profile instead → it collided with the VNC
    // browser's lock and the bot died with "Failed to connect to browser".
    args.push(`--remote-debugging-port=${attachPort}`, '--remote-debugging-host=127.0.0.1', `--user-data-dir=${profilePath}`);
  } else if (mode === 'visible' && nativeVisible) {
    // Desktop: real visible window — no --headless, no Xvnc; bot launches it directly.
    args.push(`--user-data-dir=${profilePath}`);
  } else {
    args.push('--headless=new', `--user-data-dir=${profilePath}`);
  }
  return { arguments: args, user_data_dir: profilePath, use_private_window: false };
}
