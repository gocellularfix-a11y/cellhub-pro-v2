// Companion — REST API client (desktop).
// fetch wrapper that injects Bearer auth + JSON helpers.
// No retries, no offline queue — caller decides what to do on failure.
// NOTE: bridge backend route remains `/companion-lite/*` (API contract preserved).

export class CompanionApiError extends Error {
  constructor(
    public httpStatus: number,
    public reason: string,
    message?: string,
  ) {
    super(message ?? `${httpStatus} ${reason}`);
    this.name = 'CompanionApiError';
  }
}

export interface ApiConfig {
  bridgeUrl: string;
  token?: string;       // omit for pairing endpoints
  timeoutMs?: number;
}

function makeUrl(bridgeUrl: string, path: string): string {
  const root = bridgeUrl.replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${root}/companion-lite${p}`;
}

async function send<T>(
  method: 'GET' | 'POST',
  cfg: ApiConfig,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = makeUrl(cfg.bridgeUrl, path);
  const controller = new AbortController();
  const timeoutMs = cfg.timeoutMs ?? 10_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cfg.token) headers['authorization'] = `Bearer ${cfg.token}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const name = (err as { name?: string }).name;
    if (name === 'AbortError') {
      throw new CompanionApiError(0, 'timeout', `Timed out after ${timeoutMs}ms`);
    }
    throw new CompanionApiError(0, 'network_error', err instanceof Error ? err.message : String(err));
  }
  clearTimeout(timer);

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const reason = (data as { reason?: string })?.reason ?? `http_${res.status}`;
    throw new CompanionApiError(res.status, reason);
  }
  return data as T;
}

export function apiGet<T>(cfg: ApiConfig, path: string): Promise<T> {
  return send<T>('GET', cfg, path);
}

export function apiPost<T>(cfg: ApiConfig, path: string, body?: unknown): Promise<T> {
  return send<T>('POST', cfg, path, body);
}
