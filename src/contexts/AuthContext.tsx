'use client';

import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { User } from '@/types/auth';
import { tryRefreshToken } from '@/lib/api/client';
import { isTokenNearExpiry } from '@/lib/auth/token-utils';

// Sync interval: check server for role/profile changes every 30 seconds
const SYNC_INTERVAL_MS = 30_000;

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (token: string, user: User) => void;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  isLoading: true,
  login: () => {},
  logout: () => {},
  updateUser: () => {},
});


export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const syncRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initDoneRef = useRef(false);
  const router = useRouter();

  // Clears all session state and cookies, then optionally redirects to login.
  // Stops the sync interval immediately to prevent stale syncUser calls after logout.
  const clearSession = useCallback((redirect = true) => {
    if (syncRef.current) {
      clearInterval(syncRef.current);
      syncRef.current = null;
    }
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    if (redirect) router.replace('/login');
  }, [router]);

  /**
   * Sync user profile from server. Proactively refreshes the access token
   * when it is within REFRESH_THRESHOLD_MS of expiry.
   */
  const syncUser = useCallback(async (currentToken: string): Promise<boolean> => {
    let tokenToUse = currentToken;

    // Proactive refresh: if token expires soon, renew before the API call
    if (isTokenNearExpiry(currentToken)) {
      const newToken = await tryRefreshToken();
      if (newToken) {
        tokenToUse = newToken;
        setToken(newToken);
      } else {
        clearSession();
        return false;
      }
    }

    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${tokenToUse}` },
        signal: AbortSignal.timeout(10000),
      });

      if (res.status === 401) {
        clearSession();
        return false;
      }

      if (!res.ok) return true;

      const serverUser: User = await res.json();

      setUser((prev) => {
        if (!prev) return prev;
        if (
          prev.role !== serverUser.role ||
          prev.display_name !== serverUser.display_name ||
          prev.email !== serverUser.email
        ) {
          const updated = { ...prev, ...serverUser };
          localStorage.setItem('user', JSON.stringify(updated));
          return updated;
        }
        return prev;
      });
      return true;
    } catch {
      // Network error or timeout — silently ignore, retry on next interval
      return true;
    }
  }, [clearSession]);

  // Stable refs so the one-time init closure always calls the latest callbacks
  // without needing them in the dependency array (which would re-fire init on
  // every router navigation in Next.js App Router).
  const syncUserRef = useRef(syncUser);
  const clearSessionRef = useRef(clearSession);
  syncUserRef.current = syncUser;
  clearSessionRef.current = clearSession;

  // Initial load: restore from localStorage and handle expired/near-expired tokens.
  // Runs exactly once per mount — initDoneRef prevents a second run if React
  // strict-mode or a dep change triggers the effect again.
  useEffect(() => {
    if (initDoneRef.current) return;
    initDoneRef.current = true;

    const init = async () => {
      const savedToken = localStorage.getItem('token');
      const savedUser = localStorage.getItem('user');

      if (savedToken && savedUser) {
        try {
          if (!isTokenNearExpiry(savedToken)) {
            // Always refresh on init so the kb_token access cookie is set before
            // any <img> requests fire. Falls back to savedToken if refresh fails.
            const refreshed = await tryRefreshToken();
            const tokenToUse = refreshed ?? savedToken;
            setToken(tokenToUse);
            setUser(JSON.parse(savedUser));
            await syncUserRef.current(tokenToUse);
          } else {
            // Token expired or near-expiry — try refresh before showing app
            const newToken = await tryRefreshToken();
            if (newToken) {
              setToken(newToken);
              setUser(JSON.parse(savedUser));
              await syncUserRef.current(newToken);
            } else {
              // No valid refresh cookie — clear everything and let user log in again
              clearSessionRef.current(false);
            }
          }
        } catch {
          clearSessionRef.current(false);
        }
      }

      setIsLoading(false);
    };
    init();
  }, []);

  // Keep React token state in sync when client.ts or QueryProvider refreshes the token
  // (e.g. proactive focus-refresh from QueryProvider without going through syncUser)
  useEffect(() => {
    const handler = (e: Event) => {
      const newToken = (e as CustomEvent<string>).detail;
      if (newToken) setToken(newToken);
    };
    window.addEventListener('kb:token-refreshed', handler);
    return () => window.removeEventListener('kb:token-refreshed', handler);
  }, []);

  // Periodic sync while logged in — only when tab is visible
  useEffect(() => {
    if (syncRef.current) {
      clearInterval(syncRef.current);
      syncRef.current = null;
    }

    if (!token) return;

    syncRef.current = setInterval(() => {
      if (!document.hidden) syncUser(token);
    }, SYNC_INTERVAL_MS);

    const handleVisibility = () => {
      if (!document.hidden) syncUser(token);
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (syncRef.current) {
        clearInterval(syncRef.current);
        syncRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [token, syncUser]);

  const login = useCallback((newToken: string, newUser: User) => {
    setToken(newToken);
    setUser(newUser);
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
  }, []);

  const logout = useCallback(() => {
    clearSession(false);
  }, [clearSession]);

  const updateUser = useCallback((updates: Partial<User>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, ...updates };
      localStorage.setItem('user', JSON.stringify(updated));
      return updated;
    });
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}
