export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 401 && typeof window !== 'undefined' && !location.pathname.startsWith('/login')) {
    location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
  }
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = typeof body === 'object' && body ? (Array.isArray(body.message) ? body.message.join('; ') : body.message) : body;
    throw new ApiError(res.status, String(msg || res.statusText));
  }
  return body as T;
}

/** SWR fetcher: relative /api paths, cookie auth. */
export const fetcher = <T,>(path: string) => fetch(`/api${path}`, { credentials: 'include' }).then((r) => handle<T>(r));

export function api<T = unknown>(path: string, method: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  return fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: isForm || body === undefined ? undefined : { 'content-type': 'application/json' },
    body: isForm ? body : body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => handle<T>(r));
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
