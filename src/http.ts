export interface HttpJsonOptions {
  signal?: AbortSignal;
  retry?: number;
  timeoutMs?: number;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15";

function commonHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Accept: "application/json",
    "User-Agent": USER_AGENT,
    ...extra,
  };
}

/**
 * Manual cookie jar: site sets session cookies on the first call; we echo
 * them back on later calls to the same host so consecutive requests are
 * accepted, the way a browser would. This is purely bookkeeping of what
 * the server already gave us — it does not solve challenges or bypass any
 * upstream policy.
 */
const cookieJar = new Map<string, string>();

function jarKey(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function appendSetCookies(url: string, res: Response): void {
  const host = jarKey(url);
  const headers = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
  let cookies: string[] = [];
  if (typeof headers === "function") {
    cookies = headers.call(res.headers);
  } else {
    const single = res.headers.get("set-cookie");
    if (single) cookies = [single];
  }
  if (cookies.length === 0) return;
  const existing = new Map<string, string>();
  const existingRaw = cookieJar.get(host);
  if (existingRaw) {
    for (const pair of existingRaw.split("; ")) {
      const eq = pair.indexOf("=");
      if (eq > 0) existing.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  }
  for (const cookie of cookies) {
    if (!cookie) continue;
    const [pair] = cookie.split(";");
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    existing.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  const merged = [...existing.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  cookieJar.set(host, merged);
}

export function cookieHeaderFor(url: string): string | undefined {
  return cookieJar.get(jarKey(url));
}

export async function getJson<T>(
  url: string,
  options: HttpJsonOptions & { headers?: Record<string, string> } = {},
): Promise<T> {
  const { signal, retry = 1, timeoutMs = 10_000, headers } = options;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(new Error("timeout")), timeoutMs);
  if (signal) {
    signal.addEventListener("abort", () => ctrl.abort(signal.reason), {
      once: true,
    });
  }
  try {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retry; attempt++) {
      if (ctrl.signal.aborted) {
        throw ctrl.signal.reason ?? new Error("aborted");
      }
      try {
        const allHeaders = commonHeaders(headers);
        const cookie = cookieHeaderFor(url);
        if (cookie && !allHeaders.Cookie) allHeaders.Cookie = cookie;
        const res = await fetch(url, {
          method: "GET",
          headers: allHeaders,
          signal: ctrl.signal,
        });
        appendSetCookies(url, res);
        if (res.status >= 500 && attempt < retry) {
          await res.arrayBuffer();
          await sleep(200 * 2 ** attempt);
          continue;
        }
        if (!res.ok) {
          throw new HttpError(res.status, url, `${url} → ${res.status}`);
        }
        return (await res.json()) as T;
      } catch (err) {
        lastError = err;
        if (
          err instanceof HttpError &&
          err.status >= 400 &&
          err.status < 500 &&
          err.status !== 408 &&
          err.status !== 429
        ) {
          throw err;
        }
        if (attempt >= retry) break;
        await sleep(200 * 2 ** attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runBounded<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const launchers: Promise<void>[] = [];
  const total = Math.max(1, Math.min(concurrency, items.length));
  for (let w = 0; w < total; w++) {
    launchers.push(
      (async () => {
        while (true) {
          if (signal?.aborted) return;
          const i = next++;
          if (i >= items.length) return;
          results[i] = await worker(items[i], i);
        }
      })(),
    );
  }
  await Promise.all(launchers);
  return results;
}
