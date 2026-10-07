"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { pollDelayMs } from "../../../lib/collection/ui.ts";
import type { ItemView } from "../../../lib/collection/view.ts";
import type { Grade } from "../../../lib/types.ts";
import { api } from "./api.ts";
import type { LotData } from "./api.ts";
import EntryBar from "./EntryBar.tsx";
import ItemRow from "./ItemRow.tsx";
import LotHeader from "./LotHeader.tsx";
import OfferPanel from "./OfferPanel.tsx";
import PickPanel from "./PickPanel.tsx";
import TotalsBar from "./TotalsBar.tsx";
import { ROUTES } from "@/lib/consts.ts";

type Filter = "all" | "to-pick" | "problems";
type Undo = { key: number; label: string; query: string; year: number | null; record: Grade; sleeve: Grade; notes: string };

const OFFLINE_RETRY_MS = 5000;
const UNDO_MS = 6000;

export default function LotView({ id }: { id: number }) {
  const router = useRouter();
  const valid = Number.isInteger(id) && id > 0;
  const [data, setData] = useState<LotData | null>(null);
  const [notFound, setNotFound] = useState(!valid);
  const [offline, setOffline] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [notice, setNotice] = useState<string | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [picking, setPicking] = useState<{ item: ItemView; trigger: HTMLElement } | null>(null);
  const queryRef = useRef<HTMLInputElement>(null);
  const refreshRef = useRef<() => void>(() => {});

  // Polling: fast while lookups are queued, slow otherwise, paused while the tab is hidden.
  useEffect(() => {
    if (!valid) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ctrl: AbortController | undefined;
    let stopped = false;

    const schedule = (ms: number) => {
      clearTimeout(timer);
      if (!stopped && !document.hidden) timer = setTimeout(tick, ms);
    };
    async function tick() {
      clearTimeout(timer);
      ctrl?.abort();
      const mine = (ctrl = new AbortController());
      const res = await api<LotData>(`/api/sessions/${id}`, "GET", undefined, mine.signal);
      if (mine.signal.aborted || stopped) return;
      if (res.ok) {
        setData(res.data);
        setOffline(null);
        schedule(pollDelayMs(res.data.queue.pending, res.data.queue.paused));
      } else if (res.status === 404) {
        setNotFound(true);
      } else if (res.status !== 401) {
        setOffline(res.message);
        schedule(OFFLINE_RETRY_MS);
      }
    }
    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timer);
        ctrl?.abort();
      } else void tick();
    };
    refreshRef.current = () => void tick();
    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ctrl?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [id, valid]);

  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [undo]);

  const grade = useCallback(
    async (itemId: number, patch: { record?: Grade; sleeve?: Grade }) => {
      const res = await api(`/api/items/${itemId}`, "PATCH", patch);
      if (!res.ok) setNotice(`Could not save the grade: ${res.message}`);
      refresh();
      return res.ok;
    },
    [refresh],
  );

  const note = useCallback(
    async (itemId: number, notes: string): Promise<{ ok: true } | { ok: false; message: string }> => {
      const res = await api<ItemView>(`/api/items/${itemId}`, "PATCH", { notes });
      // Show the saved row now, rather than the old note until the refresh lands.
      if (res.ok) setData((d) => (d ? { ...d, items: d.items.map((i) => (i.id === itemId ? res.data : i)) } : d));
      refresh();
      return res.ok ? { ok: true } : { ok: false, message: res.message };
    },
    [refresh],
  );

  const star = useCallback(
    async (itemId: number, pick: boolean) => {
      const res = await api(`/api/items/${itemId}`, "PATCH", { pick });
      if (!res.ok) setNotice(`Could not change the cherry-pick: ${res.message}`);
      refresh();
    },
    [refresh],
  );

  const resume = useCallback(async () => {
    const res = await api(`/api/sessions/${id}/resume`, "POST", {});
    if (!res.ok) setNotice(`Could not retry: ${res.message}`);
    refresh();
  }, [id, refresh]);

  const retry = useCallback(
    async (itemId: number) => {
      const res = await api(`/api/items/${itemId}/retry`, "POST", {});
      if (!res.ok) setNotice(`Could not retry: ${res.message}`);
      refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (item: ItemView) => {
      const res = await api(`/api/items/${item.id}`, "DELETE");
      if (!res.ok && res.status !== 404) return setNotice(`Could not remove: ${res.message}`);
      setData((d) => (d ? { ...d, items: d.items.filter((i) => i.id !== item.id) } : d));
      setUndo({ key: Date.now(), label: item.release?.title ?? item.query, query: item.query, year: item.year, record: item.record, sleeve: item.sleeve, notes: item.notes });
      refresh();
    },
    [refresh],
  );

  async function undoRemove() {
    if (!undo) return;
    const u = undo;
    setUndo(null);
    const line = { query: u.query, ...(u.year ? { year: u.year } : {}), ...(u.notes ? { notes: u.notes } : {}) };
    const res = await api(`/api/sessions/${id}/items`, "POST", { lines: [line], record: u.record, sleeve: u.sleeve });
    if (!res.ok) setNotice(`Could not undo: ${res.message}`);
    refresh();
  }

  function picked(item: ItemView) {
    setPicking(null);
    refresh();
    // After the panel unmounts: next to-pick row's button, else the query field.
    requestAnimationFrame(() => {
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-pick-for]"));
      const idx = buttons.findIndex((b) => b.dataset.pickFor === String(item.id));
      const others = [...buttons.slice(idx + 1), ...buttons.slice(0, Math.max(idx, 0))].filter((b) => b.dataset.pickFor !== String(item.id));
      (others[0] ?? queryRef.current)?.focus();
    });
  }

  if (notFound) {
    return (
      <div className="card" role="alert">
        <h2 tabIndex={-1}>Collection not found</h2>
        <p>That collection does not exist, or it was deleted.</p>
        <Link href={ROUTES.collections}>Back to Collections</Link>
      </div>
    );
  }
  if (!data) {
    return offline ? (
      <div className="card error" role="status">
        <h2>Offline, retrying</h2>
        <p>{offline}</p>
      </div>
    ) : (
      <div className="card muted loading" role="status">
        <span className="spinner" aria-hidden="true" />
        <span>Loading collection…</span>
      </div>
    );
  }

  const { session, items, totals, offer, queue, currency, oldestPricedAt, exportCounts } = data;
  const isProblem = (i: ItemView) => i.status === "error" || i.status === "no-match";
  const shown = items.filter((i) => (filter === "to-pick" ? i.status === "to-pick" : filter === "problems" ? isProblem(i) : true));
  const tabs: { key: Filter; label: string }[] = [
    { key: "all", label: `All ${totals.total}` },
    { key: "to-pick", label: `To pick ${totals.toPick}` },
    { key: "problems", label: `Problems ${totals.problems}` },
  ];

  return (
    <>
      <LotHeader session={session} oldestPricedAt={oldestPricedAt} exportCounts={exportCounts} onChanged={refresh} onDeleted={() => router.push(ROUTES.collections)} onError={setNotice} />
      <TotalsBar totals={totals} queue={queue} offline={offline} currency={currency} onResume={resume} />
      <OfferPanel offer={offer} session={session} currency={currency} onChanged={refresh} />
      <EntryBar
        key={session.id}
        sessionId={session.id}
        defaultRecord={session.defaultRecord}
        defaultSleeve={session.defaultSleeve}
        queryRef={queryRef}
        items={items}
        currency={currency}
        onAdded={refresh}
      />
      <p className="small muted caveat">Prices are Discogs asking prices and suggestions, not confirmed sales.</p>

      {notice && (
        <div className="card error notice-bar" role="alert">
          <span>{notice}</span>
          <button type="button" className="link" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="tabs" role="group" aria-label="Filter records">
        {tabs.map((t) => (
          <button key={t.key} type="button" className="tab" aria-pressed={filter === t.key} onClick={() => setFilter(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="card notice">
          <p>
            {items.length === 0
              ? "No records yet. Type a catalog number above and press Enter."
              : filter === "to-pick"
                ? "Nothing to pick."
                : filter === "problems"
                  ? "No problems."
                  : "No records."}
          </p>
        </div>
      ) : (
        <ul className="rows">
          {shown.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              currency={currency}
              onGrade={grade}
              onStar={star}
              onNote={note}
              onPick={(it, trigger) => setPicking({ item: it, trigger })}
              onRetry={retry}
              onRemove={remove}
            />
          ))}
        </ul>
      )}

      <div className="undo-wrap" role="status">
        {undo && (
          <div className="undo" key={undo.key}>
            <span>Removed “{undo.label}”</span>
            <button type="button" className="link" onClick={undoRemove}>
              Undo
            </button>
          </div>
        )}
      </div>

      {picking && (
        <PickPanel item={picking.item} trigger={picking.trigger} onClose={() => setPicking(null)} onPicked={picked} />
      )}
    </>
  );
}
