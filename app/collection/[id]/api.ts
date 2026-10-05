// Browser-side fetch helper for the lot page. Client-safe: types only from server modules.
import type { SessionRow } from "../../../lib/collection/types.ts";
import type { ItemView, QueueState, Totals } from "../../../lib/collection/view.ts";

export type LotData = { session: SessionRow; items: ItemView[]; totals: Totals; queue: QueueState };

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

/** JSON call. A 401 sends the browser to the login page; network failures come back as status 0. */
export async function api<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<ApiResult<T>> {
  try {
    const r = await fetch(path, {
      method,
      signal,
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
  } catch (e) {
    return { ok: false, status: 0, message: `Could not reach the local server (${e instanceof Error ? e.message : e}).` };
  }
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const money = (n: number) => usd.format(n);
