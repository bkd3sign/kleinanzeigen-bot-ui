/**
 * Typed fetch wrapper with automatic auth token injection and silent refresh on 401.
 */

import { isTokenNearExpiry } from '@/lib/auth/token-utils';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface FetchOptions {
  method?: HttpMethod;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail);
    this.name = 'ApiError';
  }
}

// Prevent multiple simultaneous redirects
let isRedirecting = false;

// Deduplicate concurrent refresh attempts — all 401s share one refresh call
let refreshPromise: Promise<string | null> | null = null;

function forceLogout(): void {
  if (isRedirecting || typeof window === 'undefined') return;
  isRedirecting = true;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  // Clear httpOnly refresh cookie before redirecting so it cannot be reused
  fetch('/api/auth/logout', { method: 'POST' })
    .catch(() => {})
    .finally(() => {
      fetch('/api/system/health')
        .then((r) => r.json())
        .then((data) => window.location.replace(data.setup_required ? '/setup' : '/login'))
        .catch(() => window.location.replace('/login'));
    });
}

export async function tryRefreshToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = fetch('/api/auth/refresh', { method: 'POST' })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = await res.json().catch(() => null);
        const newToken: string | null = data?.token ?? null;
        if (newToken) {
          localStorage.setItem('token', newToken);
          // Notify AuthContext so its React state stays in sync
          window.dispatchEvent(new CustomEvent('kb:token-refreshed', { detail: newToken }));
        }
        return newToken;
      })
      .catch(() => null)
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

const AUTH_ENDPOINTS = ['/api/auth/login', '/api/auth/register', '/api/auth/reset', '/api/auth/refresh', '/api/auth/logout'];
const PUBLIC_ENDPOINTS = [...AUTH_ENDPOINTS, '/system/setup', '/system/locations', '/system/health'];

async function request<T>(url: string, options: FetchOptions = {}, isRetry = false): Promise<T> {
  const { method = 'GET', body, headers = {}, signal } = options;

  const isPublic = PUBLIC_ENDPOINTS.some((p) => url.includes(p));

  // Proactively refresh before sending if the token is expired or near expiry.
  // Avoids a round-trip 401 when navigating after long inactivity (the focusManager
  // only intercepts tab-focus events, not SPA navigation clicks).
  if (!isRetry && !isPublic) {
    const earlyToken = getToken();
    if (earlyToken && isTokenNearExpiry(earlyToken)) {
      await tryRefreshToken();
    }
  }

  const token = getToken();

  // No token and not a public endpoint → force logout immediately
  if (!token && !isPublic) {
    forceLogout();
    throw new ApiError(401, 'Not authenticated');
  }

  const fetchHeaders: Record<string, string> = { ...headers };

  if (token) {
    fetchHeaders['Authorization'] = `Bearer ${token}`;
  }

  if (body && !(body instanceof FormData)) {
    fetchHeaders['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method,
    headers: fetchHeaders,
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    signal,
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      detail = err.detail || err.message || detail;
    } catch {
      // Ignore JSON parse errors
    }

    if (res.status === 401 && !isRetry && !AUTH_ENDPOINTS.some((p) => url.includes(p))) {
      // Attempt silent token refresh before giving up
      const newToken = await tryRefreshToken();
      if (newToken) {
        return request<T>(url, options, true);
      }
      forceLogout();
      throw new ApiError(res.status, detail);
    }

    if (res.status === 401 && !isPublic) {
      forceLogout();
    }

    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;

  return res.json();
}

export const api = {
  get: <T>(url: string, signal?: AbortSignal) =>
    request<T>(url, { method: 'GET', signal }),

  post: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: 'POST', body }),

  put: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: 'PUT', body }),

  delete: <T>(url: string, body?: unknown) =>
    request<T>(url, { method: 'DELETE', body }),

  upload: <T>(url: string, formData: FormData) =>
    request<T>(url, { method: 'POST', body: formData }),
};

export { ApiError };
