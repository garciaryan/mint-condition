"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api } from "@/lib/collection/client.ts";
import { searchUrl } from "@/lib/discogs-terms.ts";
import { groupCandidates } from "@/lib/form.ts";
import { checkPlan, matchIdentifiers, normalizeRunout, RUNOUT_CHECK_CAP, uncheckedCount } from "@/lib/runout.ts";
import type { Candidate, Identifier } from "@/lib/types.ts";
import DiscogsCredit from "@/components/ui/DiscogsCredit.tsx";

type RunoutState = { status: "loading" } | { status: "loaded"; identifiers: Identifier[] } | { status: "error"; message: string };

export default function Picker({
  candidates,
  query,
  year,
  onPick,
  autoFocusFilter = false,
}: {
  candidates: Candidate[];
  /** The catalog number or barcode searched, for the credit's link to the same Discogs search. */
  query: string;
  year?: number;
  onPick: (c: Candidate) => void;
  autoFocusFilter?: boolean;
}) {
  const [filter, setFilter] = useState("");
  const groups = useMemo(() => groupCandidates(candidates, filter, year), [candidates, filter, year]);

  // Runouts: fetched one pressing at a time (GET /api/releases/:id/identifiers, cached server-side), kept only while
  // the picker is open. Discogs data, covered by the credit below.
  const [runouts, setRunouts] = useState<ReadonlyMap<number, RunoutState>>(new Map());
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const [runoutQuery, setRunoutQuery] = useState("");
  const [checking, setChecking] = useState<{ done: number; total: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    abort.current = new AbortController();
    return () => abort.current?.abort();
  }, []);

  const loaded = useMemo(
    () => new Set([...runouts].filter(([, s]) => s.status === "loaded").map(([id]) => id)),
    [runouts],
  );
  const visibleIds = useMemo(() => groups.flatMap((g) => g.items.map((c) => c.id)), [groups]);
  const plan = checkPlan(visibleIds, loaded);
  const unchecked = uncheckedCount(visibleIds, loaded);
  const searching = normalizeRunout(runoutQuery) !== "";
  const identifiersOf = (id: number) => {
    const s = runouts.get(id);
    return s?.status === "loaded" ? s.identifiers : null;
  };
  const shownGroups = searching
    ? groups
        .map((g) => ({ ...g, items: g.items.filter((c) => matchIdentifiers(identifiersOf(c.id) ?? [], runoutQuery).length > 0) }))
        .filter((g) => g.items.length > 0)
    : groups;
  const checkedShowing = visibleIds.length - unchecked;

  function setOne(id: number, s: RunoutState) {
    if (abort.current?.signal.aborted) return;
    setRunouts((m) => new Map(m).set(id, s));
  }

  async function load(id: number) {
    const signal = abort.current?.signal;
    setOne(id, { status: "loading" });
    const res = await api<{ identifiers: Identifier[] }>(`/api/releases/${id}/identifiers`, "GET", undefined, signal);
    if (signal?.aborted) return;
    setOne(id, res.ok ? { status: "loaded", identifiers: res.data.identifiers } : { status: "error", message: res.message });
  }

  async function checkAll() {
    const ids = plan.toCheck;
    setChecking({ done: 0, total: ids.length });
    for (let i = 0; i < ids.length; i++) {
      await load(ids[i]); // a failed pressing records its error and the run carries on
      if (abort.current?.signal.aborted) return;
      setChecking({ done: i + 1, total: ids.length });
    }
    setChecking(null);
  }

  function toggle(id: number) {
    const opening = !open.has(id);
    setOpen((s) => {
      const next = new Set(s);
      if (opening) next.add(id);
      else next.delete(id);
      return next;
    });
    const st = runouts.get(id);
    if (opening && (!st || st.status === "error")) void load(id);
  }

  return (
    <div className="card">
      <div className="picker-head">
        <h2 tabIndex={-1} data-focus>
          {candidates.length} possible pressings
        </h2>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by country, label, format…"
          aria-label="Filter pressings"
          autoFocus={autoFocusFilter}
        />
      </div>
      <div className="runout-controls">
        <input
          type="search"
          value={runoutQuery}
          onChange={(e) => setRunoutQuery(e.target.value)}
          placeholder="Runout contains…"
          aria-label="Runout contains"
        />
        <button
          type="button"
          className="secondary"
          disabled={checking !== null || plan.overCap || plan.toCheck.length === 0}
          onClick={() => void checkAll()}
        >
          {plan.toCheck.length === 0 && visibleIds.length > 0 ? "All runouts checked" : `Check runouts (${plan.toCheck.length})`}
        </button>
      </div>
      <p className="muted small runout-status" role="status">
        {checking ? `Checked ${checking.done} of ${checking.total}` : ""}
      </p>
      {plan.overCap && <p className="muted small">Narrow to {RUNOUT_CHECK_CAP} or fewer pressings first (filter or year).</p>}
      {searching && unchecked > 0 && (
        <p className="muted small">
          {unchecked} {unchecked === 1 ? "pressing" : "pressings"} not checked yet
        </p>
      )}
      <p className="muted">Pick the one that matches your copy (check the label, country and matrix if you can).</p>
      <DiscogsCredit href={searchUrl(query)} />
      {groups.length === 0 && <p className="muted">Nothing matches that filter.</p>}
      {searching && groups.length > 0 && shownGroups.length === 0 && checkedShowing > 0 && (
        <p className="muted">No checked pressing matches that runout.</p>
      )}
      {shownGroups.map((g) => (
        <div key={g.title}>
          <h3 className="group-title">
            {g.title} <span className="muted">({g.items.length})</span>
          </h3>
          <ul className="candidates">
            {g.items.map((c) => {
              const shown = open.has(c.id) || (searching && identifiersOf(c.id) !== null);
              const panelId = `runouts-${c.id}`;
              return (
                <li key={c.id}>
                  <div className="candidate-row">
                    <button type="button" className="candidate" onClick={() => onPick(c)}>
                      <Thumb src={c.thumb} />
                      <span className="candidate-main">
                        <strong>{c.title}</strong>
                        <span className="muted">
                          {[c.label, c.catno].filter(Boolean).join(" · ")} — {c.format ?? "format unknown"}
                        </span>
                      </span>
                      <span className="candidate-meta">
                        <span>{c.country ?? "—"}</span>
                        <span>{c.year ?? "year ?"}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="runout-toggle"
                      aria-expanded={shown}
                      aria-controls={panelId}
                      onClick={() => toggle(c.id)}
                    >
                      Runouts<span className="sr-only"> for {c.title}</span>
                    </button>
                  </div>
                  {shown && <RunoutPanel id={panelId} state={runouts.get(c.id)} query={runoutQuery} onRetry={() => void load(c.id)} />}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function RunoutPanel({ id, state, query, onRetry }: { id: string; state: RunoutState | undefined; query: string; onRetry: () => void }) {
  if (!state || state.status === "loading") {
    return (
      <p id={id} className="runout-list muted small">
        Loading runouts…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <p id={id} className="runout-list small">
        {state.message}{" "}
        <button type="button" className="link" onClick={onRetry}>
          Retry
        </button>
      </p>
    );
  }
  if (state.identifiers.length === 0) {
    return (
      <p id={id} className="runout-list muted small">
        No runouts on Discogs
      </p>
    );
  }
  return (
    <ul id={id} className="runout-list small">
      {matchIdentifiers(state.identifiers, query).map(({ identifier, ranges }, i) => (
        <li key={i}>
          <span className="muted">{identifier.type}:</span> {highlight(identifier.value, ranges)}
          {identifier.description && <span className="muted"> ({identifier.description})</span>}
        </li>
      ))}
    </ul>
  );
}

function highlight(value: string, ranges: [number, number][]): ReactNode {
  if (ranges.length === 0) return value;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start < at) continue; // overlapping occurrence: the earlier mark already covers it
    if (start > at) parts.push(value.slice(at, start));
    parts.push(
      <mark key={start} className="runout-hit">
        {value.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  if (at < value.length) parts.push(value.slice(at));
  return parts;
}

export function Thumb({ src }: { src: string | null }) {
  // Plain <img>: Discogs thumbs are small and next/image would need remote config for no benefit here.
  return src ? <img className="thumb" src={src} alt="" loading="lazy" /> : <span className="thumb thumb-empty" />;
}
