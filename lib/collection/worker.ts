// Background lookup worker: one loop per process drains pending items through the shared Discogs client.
// Writes only lookup columns (via applyLookup), never grades, year or query. Server-side only.
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "../db.ts";
import { discogsAccess } from "../discogs-access.ts";
import { getConnection } from "../discogs-auth-store.ts";
import { DiscogsError } from "../discogs.ts";
import type { CachedLookupClient } from "../discogs-cache.ts";
import { getLookupClient } from "../discogs-client.ts";
import type { Candidate } from "../types.ts";
import { applyLookup, claimNextPending, countClaimable, releaseClaim, resetWorking, touchSession } from "./store.ts";
import type { ItemRow, LookupPatch } from "./types.ts";

export type WorkerDeps = {
  db?: DatabaseSync;
  client?: CachedLookupClient;
  now?: () => number;
  /** Called every keepAliveMs while the loop runs. Default: ping our own Fly URL (only when FLY_APP_NAME is set). */
  keepAlive?: () => void;
  keepAliveMs?: number;
};

const KEEP_ALIVE_MS = 60_000;

// Fly auto-stops a machine with no inbound traffic; a request through its proxy keeps it up while lookups run.
function defaultKeepAlive(): (() => void) | null {
  const app = process.env.FLY_APP_NAME;
  if (!app) return null;
  const url = `https://${app}.fly.dev/api/health`;
  return () => {
    fetch(url, { signal: AbortSignal.timeout(10_000) }).then(
      (r) => void r.body?.cancel().catch(() => {}),
      () => {},
    );
  };
}

// Loop and pause flag live on globalThis so dev reloads can't start a second loop.
type WorkerState = { loop: Promise<void> | null; paused: boolean; recentMs: number[] };
const g = globalThis as typeof globalThis & { __mintWorker?: WorkerState };
const fresh = (): WorkerState => ({ loop: null, paused: false, recentMs: [] });
const state = () => (g.__mintWorker ??= fresh());

// The throttle's pace (one Discogs call per ~1.1 s, ~3 per record) until real lookups have been timed.
const DEFAULT_MS_PER_ITEM = 3300;
const RECENT = 10;

/** Average time per lookup over the last few, so cache hits shorten the queue estimate. */
export function msPerItem(): number {
  const recent = state().recentMs;
  return recent.length === 0 ? DEFAULT_MS_PER_ITEM : recent.reduce((a, b) => a + b, 0) / recent.length;
}

// pricedAt is when Discogs answered (the older of the two), so prices served from the cache show their real age.
async function priceRelease(client: CachedLookupClient, item: ItemRow, id: number, extra: Partial<LookupPatch>): Promise<LookupPatch> {
  const opts = { fresh: item.refresh };
  const [sugg, st] = await Promise.all([client.priceSuggestions(id, opts), client.releaseStats(id, opts)]);
  const suggestions = sugg.value;
  const status = suggestions && suggestions[item.record] !== undefined ? "priced" : "no-price";
  return { status, ...extra, suggestions: suggestions ?? null, stats: st.value, pricedAt: Math.min(sugg.fetchedAt, st.fetchedAt) };
}

/** Discogs can't be called at all yet (not connected, or not set up). Throws out of processItem. */
const isNotReady = (e: unknown): boolean => e instanceof DiscogsError && (e.kind === "not-connected" || e.status === 0);

/** Prices one row. Throws only when Discogs is not connected or not set up, so the row can stay pending. */
export async function processItem(client: CachedLookupClient, item: ItemRow, _now: number): Promise<LookupPatch & { pauseQueue?: true }> {
  try {
    if (item.releaseId !== null) return await priceRelease(client, item, item.releaseId, {});
    const { value: found }: { value: Candidate[] } = await client.searchByCatno(item.query, item.year ?? undefined, {
      fresh: item.refresh,
    });
    if (found.length === 0) return { status: "no-match", candidates: null };
    if (found.length > 1) return { status: "to-pick", candidates: found };
    const only = found[0];
    return await priceRelease(client, item, only.id, { releaseId: only.id, release: only, candidates: null });
  } catch (e) {
    // Not connected (or not set up) is no fault of this row: the caller leaves it pending.
    if (isNotReady(e)) throw e;
    if (e instanceof DiscogsError && e.status === 401) {
      // A revoked OAuth connection says to reconnect; a token-mode 401 keeps the short message.
      return { status: "error", error: e.kind === "reconnect" ? e.message.slice(0, 200) : "Discogs rejected the token", pauseQueue: true };
    }
    return { status: "error", error: (e instanceof Error ? e.message : "Unexpected error").slice(0, 200) };
  }
}

/** Resolves true when the loop must not re-kick itself: an unexpected error, or Discogs not connected or set up. */
async function runLoop(db: DatabaseSync, client: CachedLookupClient, nowFn: () => number): Promise<boolean> {
  let claimed: number | null = null;
  try {
    while (!state().paused) {
      const item = claimNextPending(db);
      if (!item) return false;
      claimed = item.id;
      const started = nowFn();
      let patch: Awaited<ReturnType<typeof processItem>>;
      try {
        patch = await processItem(client, item, started);
      } catch (e) {
        if (!isNotReady(e)) throw e;
        // Disconnected mid-queue: leave this row (and the rest) pending until a connect kicks the worker again.
        releaseClaim(db, item.id);
        claimed = null;
        return true;
      }
      const recent = state().recentMs;
      recent.push(Math.max(0, nowFn() - started));
      if (recent.length > RECENT) recent.shift();
      const { pauseQueue, ...write } = patch;
      applyLookup(db, item.id, write);
      claimed = null;
      touchSession(db, item.sessionId, nowFn());
      if (pauseQueue) {
        state().paused = true;
        return false;
      }
    }
    return false;
  } catch (e) {
    console.error("lookup worker stopped:", e instanceof Error ? e.message : "unknown error");
    try {
      if (claimed !== null) releaseClaim(db, claimed);
    } catch {}
    return true;
  }
}

export function kickWorker(deps: WorkerDeps = {}): Promise<void> {
  const s = state();
  if (s.loop) return s.loop;
  if (s.paused) return Promise.resolve();
  const db = deps.db ?? getDb();
  if (!deps.client && discogsAccess(process.env, getConnection(db)).kind === "none") return Promise.resolve();
  const ping = deps.keepAlive ?? defaultKeepAlive();
  const timer = ping ? setInterval(ping, deps.keepAliveMs ?? KEEP_ALIVE_MS) : null;
  timer?.unref?.();
  let failed = false;
  const loop: Promise<void> = runLoop(db, deps.client ?? getLookupClient(), deps.now ?? Date.now)
    .then((f) => {
      failed = f;
    })
    .finally(() => {
      if (timer) clearInterval(timer);
      if (s.loop === loop) s.loop = null;
      // Rows added just as the loop finished would otherwise wait for the next kick.
      if (!failed && !s.paused && countClaimable(db) > 0) void kickWorker(deps);
    });
  s.loop = loop;
  return loop;
}

export const isQueuePaused = (): boolean => state().paused;
export const resumeQueue = (): void => {
  state().paused = false;
};

export function startWorkerOnBoot(): void {
  resetWorking(getDb());
  void kickWorker();
}

export function __resetWorkerForTests(): void {
  g.__mintWorker = fresh();
}
