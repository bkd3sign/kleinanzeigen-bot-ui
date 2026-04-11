'use client';

import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { User } from '@/types/auth';

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
  const router = useRouter();

  /**
   * Sync user profile from server — detects role changes, token invalidation, etc.
   * Returns false if the token was invalid (caller should treat as logged out).
   */
  const syncUser = useCallback(async (currentToken: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${currentToken}` },
        signal: AbortSignal.timeout(10000),
      });

      if (res.status === 401) {
        // Token expired or invalidated — clear state and redirect to login
        setToken(null);
        setUser(null);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        router.replace('/login');
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
  }, [router]);

  // Initial load from localStorage + server token validation before rendering app
  useEffect(() => {
    const init = async () => {
      const savedToken = localStorage.getItem('token');
      const savedUser = localStorage.getItem('user');
      if (savedToken && savedUser) {
        try {
          setToken(savedToken);
          setUser(JSON.parse(savedUser));
          await syncUser(savedToken);
        } catch {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        }
      }
      // Always finish loading — even if token was invalid
      setIsLoading(false);
    };
    init();
  }, [syncUser]);

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

    // Sync immediately when tab becomes visible again (catches long idle periods)
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
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }, []);

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
