'use client';

import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useToast } from '@/components/ui';

interface VncStatusResponse {
  status: 'none' | 'starting' | 'ready' | 'error';
  token?: string;
  loggedIn?: boolean;
  /** A bot job is attached to this browser — treat the window as a read-only viewer. */
  jobRunning?: boolean;
  /** Configured browser mode — drives where "Chrome öffnen" controls appear. */
  mode?: 'auto' | 'headless' | 'visible';
  /** The bot attaches to (runs inside) this VNC browser — server-computed from mode +
   *  hasNativeDisplay. Authoritative; the client can't derive it from mode alone. */
  attachMode?: boolean;
  /** The workspace's newest job is waiting for a manual login (auto mode). */
  loginRequired?: boolean;
}

export interface UseVncLogin {
  /** Whether the embedded login window should be visible. */
  modalOpen: boolean;
  /** Token routing noVNC to this workspace's Xvnc instance (null when no session). */
  token: string | null;
  /** A start/teardown request is in flight. */
  busy: boolean;
  /** A VNC session exists for this workspace (starting or ready). */
  active: boolean;
  /** Configured browser mode. undefined until the status query first resolves
   *  (lets callers avoid a render flash before the mode is known). */
  mode: 'auto' | 'headless' | 'visible' | undefined;
  /** The workspace's newest job is waiting for a manual login (drives auto-mode section). */
  loginRequired: boolean;
  /** A bot job is attached to this browser — the window is a read-only viewer. */
  jobRunning: boolean;
  /** Start a fresh session and open the window. */
  start: () => Promise<void>;
  /** Open the window for an already-active session, or start one if none exists. */
  openWindow: () => void;
  /** Close the viewer. In visible/attach mode this only hides it (session stays warm);
   *  in auto/headless mode it also tears the session down. */
  close: () => Promise<void>;
  /** Explicitly stop the session (kill the browser), regardless of mode ("Beenden"). */
  stop: () => Promise<void>;
}

const VNC_QUERY_KEY = ['vnc-status'];

// Number of consecutive logged-in polls required before auto-closing the recovery
// window. The VNC browser starts on the SSO login page (KA_START_URL); its URL can briefly
// match isLoggedInUrl during a redirect hop before settling in the login flow — a single
// poll could catch that flash and tear the window down before the user has logged in.
// Requiring stability across polls bridges the flash and gives the browser time to
// persist the session cookies, so the subsequent headless re-run reuses the warm session.
const LOGIN_CONFIRM_POLLS = 2;

// Escape-hatch deadline for the connecting state. MUST exceed the server's cold-start CDP
// wait (CDP_COLD_START_TIMEOUT_MS = 90s in lifecycle.ts) plus a poll interval, so a
// legitimately slow cold start is never closed before the server resolves.
const VNC_CONNECTING_TIMEOUT_MS = 120_000;

/**
 * Manage the per-workspace VNC login session: start, poll status, auto-detect a
 * successful manual login, and tear down. Shared by the job-detail banner and the
 * jobs-overview status control so both use one mechanism (one polling query).
 *
 * @param onLoginSuccess optional caller action after login is detected (e.g. re-run
 *   the job). Must be stable (useCallback) — it is an effect dependency.
 */
export function useVncLogin(onLoginSuccess?: () => void): UseVncLogin {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Whether this window was opened for login recovery (start) vs. just viewing (openWindow).
  // Only the recovery flow auto-closes + re-runs the job once logged in; viewing stays open.
  const [autoCloseOnLogin, setAutoCloseOnLogin] = useState(false);

  const { data, dataUpdatedAt } = useQuery<VncStatusResponse>({
    queryKey: VNC_QUERY_KEY,
    // ?open=1 is a heartbeat that keeps the session alive while the window is open;
    // without it the server reaps the idle session after a timeout.
    queryFn: () => api.get<VncStatusResponse>(modalOpen ? '/api/bot/vnc?open=1' : '/api/bot/vnc'),
    // Poll fast while the window is open (catch the login), slowly otherwise (keep
    // the status indicator fresh without hammering the CDP endpoint).
    refetchInterval: modalOpen ? 3000 : 8000,
  });

  // Count consecutive logged-in polls so a transient start-URL flash doesn't trigger a
  // premature auto-close. dataUpdatedAt advances on every successful refetch (even when
  // the payload is identical via structural sharing), so this counts polls reliably.
  const [loginStreak, setLoginStreak] = useState(0);
  useEffect(() => {
    if (!modalOpen || !autoCloseOnLogin) {
      setLoginStreak(0);
      return;
    }
    setLoginStreak(prev => (data?.loggedIn ? prev + 1 : 0));
  }, [dataUpdatedAt, modalOpen, autoCloseOnLogin, data?.loggedIn]);

  const active = data?.status === 'ready' || data?.status === 'starting';

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: VNC_QUERY_KEY });
  }, [queryClient]);

  const startSession = useCallback(async (autoClose: boolean) => {
    if (busy) return;
    setBusy(true);
    setAutoCloseOnLogin(autoClose);
    // Open the window immediately in its connecting state instead of blocking on the POST
    // (a cold Chromium+Xvnc start can take many seconds). The token fills in when ready.
    setModalOpen(true);
    try {
      // POST resolves only once startVncLogin reached 'ready' (it awaits CDP) or throws, so
      // the returned session is always connectable — safe to surface its token directly.
      const res = await api.post<{ token: string }>('/api/bot/vnc');
      setToken(res.token);
      invalidate();
    } catch (e) {
      setModalOpen(false);
      setAutoCloseOnLogin(false);
      toast('error', e instanceof Error ? e.message : 'VNC-Login konnte nicht gestartet werden.');
    } finally {
      setBusy(false);
    }
  }, [busy, invalidate, toast]);

  // Login-recovery entry (banner): close + re-run the job once logged in.
  const start = useCallback(() => startSession(true), [startSession]);

  // Viewing entry (jobs bar / pill / running-job modal): keep the window open.
  const openWindow = useCallback(() => {
    // Idempotent: if the window is already open (connecting or showing), repeated clicks
    // from any button must not start/attach a second browser on the shared profile.
    if (modalOpen || busy) return;
    setAutoCloseOnLogin(false);
    // An existing session (ready OR still starting) or a visible-mode job already bringing up
    // its own attach browser: just open the viewer. NEVER spawn a second Chromium on the
    // shared profile (they collide on the profile lock and both fail → CDP timeout). The token
    // is surfaced by the ready-gated sync effect only once the backend is actually
    // connectable, so a window opened mid-cold-start shows the connecting spinner instead of a
    // dead noVNC frame (opening the iframe before Xvnc/CDP are reachable burns noVNC's one-shot
    // autoconnect and leaves a blank viewer until a manual reload).
    if (active || data?.jobRunning) {
      setModalOpen(true);
    } else {
      void startSession(false);
    }
  }, [modalOpen, busy, active, data?.jobRunning, startSession]);

  // Keep the local token in sync with the authoritative session token while the window is
  // open: fills it after the optimistic connecting state, and UPDATES it if the session
  // changes (e.g. reopened after a reap/lock-handover minted a new token) so the iframe
  // never reconnects with a stale/dead token. Not cleared on a momentary null (a live
  // session always reports its token) — a truly gone session is handled by the timeout.
  //
  // Gate on status === 'ready': a token exists throughout the whole 'starting' cold-start
  // window (GET returns session.token before Xvnc/CDP are reachable). Surfacing it early
  // would load the noVNC iframe against a not-yet-routable backend; noVNC's one-shot
  // autoconnect then gives up and shows a blank viewer. Only surface it once connectable, so
  // the modal keeps showing the connecting spinner until then.
  useEffect(() => {
    if (modalOpen && data?.status === 'ready' && data?.token && data.token !== token) {
      setToken(data.token);
    }
  }, [modalOpen, token, data?.status, data?.token]);

  // Escape hatch for the connecting state: if the session never becomes ready (Xvnc/bot
  // crash, or a stuck 'starting'), don't spin forever — surface an error and close. The
  // grace period must exceed the server's cold-start CDP wait (90s) plus a poll interval so
  // a legitimately slow cold start is never closed early. Cleared as soon as the token fills.
  useEffect(() => {
    if (!modalOpen || token) return;
    const timer = setTimeout(() => {
      toast('error', 'Browser konnte nicht gestartet werden — bitte erneut versuchen.');
      setModalOpen(false);
    }, VNC_CONNECTING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [modalOpen, token, toast]);

  // Full teardown: hide the window AND stop the session (kill Xvnc + Chromium). The server
  // ignores this while a bot job is attached, so it never kills a running job's browser.
  const teardown = useCallback(async () => {
    setModalOpen(false);
    setToken(null);
    try {
      await api.delete('/api/bot/vnc');
    } catch {
      // Best-effort: the session is reaped on idle / the next bot run anyway, but tell
      // the user the teardown request itself failed.
      toast('error', 'Browser-Sitzung konnte nicht beendet werden — wird automatisch bereinigt.');
    }
    invalidate();
  }, [invalidate, toast]);

  // Close the viewer window. In visible/attach mode the browser is meant to stay warm
  // (constant session, same fingerprint → instant reopen, no re-login), so closing only
  // HIDES it — the session lives on and is stopped explicitly via stop() ("Beenden"). In
  // auto/headless mode there is nothing to keep warm, so closing frees the browser.
  const close = useCallback(async () => {
    if (data?.attachMode) { setModalOpen(false); return; }
    await teardown();
  }, [data?.attachMode, teardown]);

  // Auto-close ONLY when the window was opened for login recovery (start), once login
  // succeeds: tear down the VNC browser, notify, and re-run the job. Viewing windows
  // (openWindow) never auto-close — the trigger is the entry point, not the poll status,
  // so it is immune to transient "logged-out" states during startup/page load.
  // jobRunning still guards: a window attached to a live bot must not be torn down.
  // loginStreak guards against the start-URL flash: the login must hold across polls.
  useEffect(() => {
    if (!modalOpen || data?.jobRunning || !autoCloseOnLogin) return;
    if (loginStreak < LOGIN_CONFIRM_POLLS) return;
    setModalOpen(false);
    setToken(null);
    setAutoCloseOnLogin(false);
    // In attach mode the bot re-run runs INSIDE this VNC browser, so it must stay alive —
    // tearing it down here would leave the bot with "Browser process not reachable". Only
    // headless/auto re-runs read the session from the profile, so only they tear it down.
    // attachMode is server-authoritative (it knows hasNativeDisplay); never recompute here.
    if (!data?.attachMode) {
      api.delete('/api/bot/vnc').catch(() => { /* cleaned up next run */ });
    }
    invalidate();
    toast('success', 'Anmeldung erkannt — Browser-Session ist jetzt aktiv.');
    onLoginSuccess?.();
  }, [modalOpen, loginStreak, data?.jobRunning, data?.attachMode, autoCloseOnLogin, onLoginSuccess, invalidate, toast]);

  return { modalOpen, token, busy, active: !!active, mode: data?.mode, loginRequired: !!data?.loginRequired, jobRunning: !!data?.jobRunning, start, openWindow, close, stop: teardown };
}
