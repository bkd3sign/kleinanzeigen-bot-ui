/**
 * Typed fetch wrapper with automatic auth token injection.
 */

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

function forceLogout(): void {
  if (isRedirecting || typeof window === 'undefined') return;
  isRedirecting = true;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  // Redirect to /setup if no users exist, otherwise /login
  fetch('/api/system/health')
    .then((r) => r.json())
    .then((data) => window.location.replace(data.setup_required ? '/setup' : '/login'))
    .catch(() => window.location.replace('/login'));
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

async function request<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, signal } = options;
  const token = getToken();

  // No token and not a public endpoint → force logout immediately
  if (!token && !url.includes('/auth/login') && !url.includes('/auth/register') && !url.includes('/auth/reset') && !url.includes('/system/setup') && !url.includes('/system/locations') && !url.includes('/system/health')) {
    forceLogout();
    throw new ApiError(401, 'Not authenticated');
  }

  const fetchHeaders: Record<string, string> = {
    ...headers,
  };

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

    if (res.status === 401) {
      forceLogout();
      throw new ApiError(res.status, detail);
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
