// Fetch with timeout and exponential backoff. 404 is a normal answer ("not published"),
// so it is returned rather than retried. Pure: global fetch only (Workers, Node, Bun).

export class HttpError extends Error {
  constructor(
    public status: number,
    url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

export interface FetchOptions {
  attempts?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  accept?: string;
  referer?: string;
}

let defaultBaseDelay = 800;
/** Tests shorten the backoff; production keeps 0.8 s, 1.6 s, 3.2 s … */
export function setRetryBaseDelay(ms: number) {
  defaultBaseDelay = ms;
}

const UA = "Mozilla/5.0 (compatible; SerbiaGasDashboard/1.0; +exchange price monitor)";

/** Returns the Response for 2xx and 404; throws HttpError/network errors after retries. */
export async function fetchWithRetry(url: string, opts: FetchOptions = {}): Promise<Response> {
  const attempts = opts.attempts ?? 3;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const base = opts.baseDelayMs ?? defaultBaseDelay;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "user-agent": UA,
          accept: opts.accept ?? "*/*",
          ...(opts.referer ? { referer: opts.referer } : {}),
        },
      });
      if (res.ok || res.status === 404) return res;
      lastErr = new HttpError(res.status, url);
      // Client errors other than throttling will not change on retry.
      if (res.status < 500 && res.status !== 429 && res.status !== 408) throw lastErr;
    } catch (err) {
      lastErr = err;
      if (err instanceof HttpError && err.status < 500 && err.status !== 429 && err.status !== 408)
        throw err;
    } finally {
      clearTimeout(timer);
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, base * 2 ** i));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string | null> {
  const res = await fetchWithRetry(url, opts);
  if (res.status === 404) return null;
  return res.text();
}

export async function fetchBytes(url: string, opts: FetchOptions = {}): Promise<Uint8Array | null> {
  const res = await fetchWithRetry(url, opts);
  if (res.status === 404) return null;
  return new Uint8Array(await res.arrayBuffer());
}
