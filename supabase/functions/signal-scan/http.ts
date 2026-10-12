// fetch with retry on 429 / 5xx / network errors, exponential backoff.
// A 429 that says the quota is exhausted is not retried: it won't clear in seconds.

export class HttpError extends Error {
  readonly status: number;
  readonly retriable: boolean;
  constructor(status: number, message: string, retriable: boolean) {
    super(message);
    this.status = status;
    this.retriable = retriable;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  { retries = 3, timeoutMs = 30_000, label = "request" } = {},
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1) + Math.random() * 300);
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return res;
      const body = (await res.text()).replace(/\s+/g, " ").slice(0, 400);
      const retriable = res.status >= 500 || (res.status === 429 && !/quota/i.test(body));
      lastError = new HttpError(res.status, `${label} failed: HTTP ${res.status} ${body}`, retriable);
      if (!retriable) throw lastError;
      const retryAfter = Number(res.headers.get("retry-after"));
      if (retryAfter > 0 && retryAfter <= 10) await sleep(retryAfter * 1000);
    } catch (e) {
      if (e instanceof HttpError && !e.retriable) throw e;
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${label} failed`);
}
