export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return { error: text }; } })() : {};
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.code);
  return data as T;
}

/** Kiosk API (no cookies). */
export async function kioskApi<T>(path: string, opts: { method?: string; body?: unknown; orderKey?: string; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/kiosk${path}`, {
      method: opts.method ?? 'GET',
      headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.orderKey ? { 'X-Order-Key': opts.orderKey } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal ?? AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the canteen server. Please try again.', 'network');
  }
  return handle<T>(res);
}

/** Admin API: same-origin session cookie + CSRF header. Redirects to login on 401. */
export async function adminApi<T>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/admin${path}`, {
      method: opts.method ?? 'GET',
      credentials: 'same-origin',
      headers: { 'X-CRTL-Admin': '1', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server', 'network');
  }
  if (res.status === 401 && !path.startsWith('/auth/')) {
    window.dispatchEvent(new CustomEvent('crtl:unauthorized'));
  }
  return handle<T>(res);
}
