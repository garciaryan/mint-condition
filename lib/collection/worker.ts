// Background lookup worker: one loop per process drains pending items through the shared Discogs client.
// Writes only lookup columns (via applyLookup), never grades, year or query. Server-side only.
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "../db.ts";
import { DiscogsError } from "../discogs.ts";
import { getDiscogsClient } from "../discogs-client.ts";
import { missingEnv } from "../lookup.ts";
import type { LookupClient } from "../lookup.ts";
import type { Candidate } from "../types.ts";
import { applyLookup, claimNextPending, resetWorking, touchSession } from "./store.ts";
import type { ItemRow, LookupPatch } from "./types.ts";

export type WorkerDeps = { db?: DatabaseSync; client?: LookupClient; now?: () => number };

// Loop and pause flag live on globalThis so dev reloads can't start a second loop.
const g = globalThis as typeof globalThis & { __mintWorker?: { loop: Promise<void> | null; paused: boolean } };
const state = () => (g.__mintWorker ??= { loop: null, paused: false });

async function priceRelease(client: LookupClient, item: ItemRow, id: number, now: number, extra: Partial<LookupPatch>): Promise<LookupPatch> {
  const [suggestions, stats] = await Promise.all([client.priceSuggestions(id), client.marketplaceStats(id)]);
  const status = suggestions && suggestions[item.record] !== undefined ? "priced" : "no-price";
  return { status, ...extra, suggestions: suggestions ?? null, stats, pricedAt: now };
}

export async function processItem(client: LookupClient, item: ItemRow, now: number): Promise<LookupPatch & { pauseQueue?: true }> {
  try {
    if (item.releaseId !== null) return await priceRelease(client, item, item.releaseId, now, {});
    const found: Candidate[] = await client.searchByCatno(item.query, item.year ?? undefined);
    if (found.length === 0) return { status: "no-match", candidates: null };
    if (found.length > 1) return { status: "to-pick", candidates: found };
    const only = found[0];
    return await priceRelease(client, item, only.id, now, { releaseId: only.id, release: only, candidates: null });
  } catch (e) {
    if (e instanceof DiscogsError && e.status === 401) {
      return { status: "error", error: "Discogs rejected the token", pauseQueue: true };
    }
    return { status: "error", error: (e instanceof Error ? e.message : "Unexpected error").slice(0, 200) };
  }
}

async function runLoop(db: DatabaseSync, client: LookupClient, nowFn: () => number): Promise<void> {
  try {
    while (!state().paused) {
      const item = claimNextPending(db);
      if (!item) return;
      const patch = await processItem(client, item, nowFn());
      const { pauseQueue, ...write } = patch;
      applyLookup(db, item.id, write);
      touchSession(db, item.sessionId, nowFn());
      if (pauseQueue) {
        state().paused = true;
        return;
      }
    }
  } catch (e) {
    console.error("lookup worker stopped:", e instanceof Error ? e.message : "unknown error");
  }
}

export function kickWorker(deps: WorkerDeps = {}): Promise<void> {
  const s = state();
  if (s.loop) return s.loop;
  if (s.paused) return Promise.resolve();
  if (!deps.client && missingEnv(process.env).length > 0) return Promise.resolve();
  const loop = runLoop(deps.db ?? getDb(), deps.client ?? getDiscogsClient(), deps.now ?? Date.now).finally(() => {
    if (s.loop === loop) s.loop = null;
  });
  s.loop = loop;
  return loop;
}

export const isQueuePaused = (): boolean => state().paused;
export const resumeQueue = (): void => {
  state().paused = false;
};

export function startWorkerOnBoot(): void {
  if (missingEnv(process.env).length > 0) return;
  resetWorking(getDb());
  void kickWorker();
}

export function __resetWorkerForTests(): void {
  g.__mintWorker = { loop: null, paused: false };
}
