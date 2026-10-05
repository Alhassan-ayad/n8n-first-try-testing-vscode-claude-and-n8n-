const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
const KEY = 'cep_token';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 && !path.startsWith('/admin/auth/login')) {
    setToken(null);
    window.location.assign('/login');
    throw new ApiError('Signed out', 401);
  }
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) {
    const d = data as { error?: string; details?: unknown } | null;
    throw new ApiError(d?.error ?? res.statusText, res.status, d?.details);
  }
  return data as T;
}

export async function download(path: string, filename: string) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.statusText, res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export interface Me {
  id: string;
  email: string;
  name: string;
  roles: string[];
}

export function hasRole(me: Me | undefined, ...roles: string[]) {
  return !!me && (me.roles.includes('admin') || roles.some((r) => me.roles.includes(r)));
}
