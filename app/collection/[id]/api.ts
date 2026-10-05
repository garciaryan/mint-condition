// Browser-side fetch helper for the lot page. Client-safe: types only from server modules.
import type { SessionRow } from "../../../lib/collection/types.ts";
import type { ItemView, QueueState, Totals } from "../../../lib/collection/view.ts";
import type { OfferView } from "../../../lib/offer.ts";

export type LotData = {
  session: SessionRow;
  items: ItemView[];
  totals: Totals;
  offer: OfferView;
  queue: QueueState;
  currency: string;
};

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

const TIMEOUT_MS = 15000;

/** The caller's signal plus a 15 s timeout. `timedOut()` tells the two apart after an abort. */
function withTimeout(signal?: AbortSignal): { signal: AbortSignal; timedOut: () => boolean; done: () => void } {
  const timeout = new AbortController();
  let fired = false;
  const timer = setTimeout(() => {
    fired = true;
    timeout.abort();
  }, TIMEOUT_MS);
  const done = () => clearTimeout(timer);
  const timedOut = () => fired;
  if (!signal) return { signal: timeout.signal, timedOut, done };
  if (typeof AbortSignal.any === "function") return { signal: AbortSignal.any([signal, timeout.signal]), timedOut, done };
  const both = new AbortController();
  const abort = () => both.abort();
  if (signal.aborted) abort();
  signal.addEventListener("abort", abort, { once: true });
  timeout.signal.addEventListener("abort", abort, { once: true });
  return { signal: both.signal, timedOut, done };
}

/** JSON call. A 401 sends the browser to the login page; network failures come back as status 0. */
export async function api<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<ApiResult<T>> {
  const t = withTimeout(signal);
  try {
    const r = await fetch(path, {
      method,
      signal: t.signal,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.status === 401) {
      location.assign(`/login?next=${location.pathname}`);
      return { ok: false, status: 401, message: "Signing in again…" };
    }
    if (!r.ok) {
      let message = `Request failed (${r.status}).`;
      try {
        const b = (await r.json()) as { message?: string };
        if (b.message) message = b.message;
      } catch {}
      return { ok: false, status: r.status, message };
    }
    return { ok: true, data: (await r.json()) as T };
  } catch {
    if (t.timedOut() && !signal?.aborted) return { ok: false, status: 0, message: "Request timed out." };
    return { ok: false, status: 0, message: NETWORK_ERROR };
  } finally {
    t.done();
  }
}

export const NETWORK_ERROR = "Could not reach the server. Check your connection.";

const formats = new Map<string, Intl.NumberFormat>();
export function money(n: number, currency = "USD"): string {
  let f = formats.get(currency);
  if (!f) {
    try {
      f = new Intl.NumberFormat("en-US", { style: "currency", currency });
    } catch {
      f = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
    }
    formats.set(currency, f);
  }
  return f.format(n);
}
