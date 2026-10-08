"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/collection/client.ts";
import { dataExpired, MAX_CACHE_HOURS, masterUrl } from "@/lib/discogs-terms.ts";
import { earliestYear, filterVersions, pageOf, paginate, sortVersions, thisCopyYear, versionFlag, VERSIONS_PAGE_SIZE } from "@/lib/versions.ts";
import type { VersionsResponse } from "@/lib/versions.ts";
import type { Candidate } from "@/lib/types.ts";
import DiscogsCredit from "@/components/ui/DiscogsCredit.tsx";
import { Thumb } from "@/components/lookup/Picker.tsx";

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; data: VersionsResponse }
  | { status: "error"; message: string };

/**
 * "Vinyl versions" on the result card: the master's vinyl versions (GET /api/masters/:id/versions, fetched on first
 * open), this copy and the earliest listed year marked. Rendered with key = release id, so a new release starts closed.
 */
export default function VersionsPanel({
  masterId,
  releaseId,
  fallbackYear,
  busy,
  onPick,
}: {
  masterId: number;
  releaseId: number;
  /** The card's year for this copy, used when it isn't among the versions fetched. */
  fallbackYear: number | null;
  busy: boolean;
  onPick: (c: Candidate) => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ status: "idle" });
  const [filter, setFilter] = useState("");
  // null until the user pages: then the list opens on the page holding this copy.
  const [page, setPage] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  // Discogs terms: a list left open past 6 hours is hidden until reloaded.
  const fetchedAt = state.status === "loaded" ? state.data.fetchedAt : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (fetchedAt === null) return;
    setNow(Date.now());
    const wait = fetchedAt + MAX_CACHE_HOURS * 3_600_000 - Date.now() + 1000;
    if (wait <= 0) return;
    const t = setTimeout(() => setNow(Date.now()), wait);
    return () => clearTimeout(t);
  }, [fetchedAt]);

  async function load() {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setState({ status: "loading" });
    const res = await api<VersionsResponse>(`/api/masters/${masterId}/versions`, "GET", undefined, ctrl.signal);
    if (ctrl.signal.aborted) return;
    setState(res.ok ? { status: "loaded", data: res.data } : { status: "error", message: res.message });
  }

  function toggle() {
    setOpen(!open);
    if (!open && (state.status === "idle" || state.status === "error")) void load();
  }

  return (
    <div className="versions">
      <button type="button" className="secondary" aria-expanded={open} aria-controls="versions-panel" onClick={toggle}>
        Vinyl versions
      </button>
      {open && (
        <div id="versions-panel" className="versions-panel">
          {state.status === "idle" || state.status === "loading" ? (
            <p className="muted loading">
              <span className="spinner" aria-hidden="true" />
              <span>Loading versions…</span>
            </p>
          ) : state.status === "error" ? (
            <p className="small">
              {state.message}{" "}
              <button type="button" className="link" onClick={() => void load()}>
                Retry
              </button>
            </p>
          ) : dataExpired(state.data.fetchedAt, now) ? (
            <p className="notice small">
              These versions are more than {MAX_CACHE_HOURS} hours old.{" "}
              <button type="button" className="link" onClick={() => void load()}>
                Reload
              </button>
            </p>
          ) : (
            <VersionsList
              data={state.data}
              releaseId={releaseId}
              fallbackYear={fallbackYear}
              filter={filter}
              setFilter={setFilter}
              page={page}
              setPage={setPage}
              busy={busy}
              onPick={onPick}
            />
          )}
          <DiscogsCredit href={masterUrl(masterId)} />
        </div>
      )}
    </div>
  );
}

function VersionsList({
  data,
  releaseId,
  fallbackYear,
  filter,
  setFilter,
  page,
  setPage,
  busy,
  onPick,
}: {
  data: VersionsResponse;
  releaseId: number;
  fallbackYear: number | null;
  filter: string;
  setFilter: (s: string) => void;
  page: number | null;
  setPage: (p: number) => void;
  busy: boolean;
  onPick: (c: Candidate) => void;
}) {
  const sorted = useMemo(() => sortVersions(data.versions), [data.versions]);
  const listRef = useRef<HTMLDivElement>(null);
  if (sorted.length === 0) return <p className="muted">No vinyl versions listed on Discogs.</p>;

  const earliest = earliestYear(sorted);
  const thisYear = thisCopyYear(sorted, releaseId, fallbackYear);
  const flag = versionFlag(thisYear, earliest);
  const summary =
    flag === "reissue"
      ? `This copy (${thisYear}) is a reissue. Earliest vinyl listed on Discogs: ${earliest}.`
      : flag === "earliest"
        ? `This copy is from the earliest year listed on Discogs (${earliest}).`
        : earliest !== null
          ? `Earliest vinyl listed on Discogs: ${earliest}.`
          : "";
  const n = sorted.length;
  const count =
    data.total > n ? `Showing the first ${n} of ${data.total} vinyl versions` : `${n} vinyl ${n === 1 ? "version" : "versions"}`;
  const shown = filterVersions(sorted, filter);
  const paged = paginate(shown, page ?? pageOf(shown.findIndex((c) => c.id === releaseId), VERSIONS_PAGE_SIZE), VERSIONS_PAGE_SIZE);

  // A new page keeps the reader's place: back to the top of the list, focus on it.
  function go(p: number) {
    setPage(p);
    const el = listRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    el.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  }

  return (
    <>
      <p className="versions-summary" role="status">
        {summary}
      </p>
      <div className="versions-head">
        <span className="muted small">{count}</span>
        <input
          type="search"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(1);
          }}
          placeholder="Filter by label, country, catno, year…"
          aria-label="Filter versions"
        />
      </div>
      {shown.length === 0 ? (
        <p className="muted">Nothing matches that filter.</p>
      ) : (
        <div ref={listRef} tabIndex={-1} className="versions-list" aria-label={`Vinyl versions, page ${paged.page} of ${paged.pages}`}>
          <ul className="candidates">
            {paged.items.map((c) => {
              const current = c.id === releaseId;
              const body = (
                <>
                  <Thumb src={c.thumb} />
                  <span className="candidate-main">
                    <strong>{[c.label, c.catno].filter(Boolean).join(" · ") || c.title}</strong>
                    <span className="muted">{c.format ?? "format unknown"}</span>
                    {(current || (earliest !== null && c.year === earliest)) && (
                      <span className="version-chips">
                        {current && <span className="version-chip current">This copy</span>}
                        {earliest !== null && c.year === earliest && <span className="version-chip">Earliest listed</span>}
                      </span>
                    )}
                  </span>
                  <span className="candidate-meta">
                    <span>{c.country ?? "—"}</span>
                    <span>{c.year ?? "year ?"}</span>
                  </span>
                </>
              );
              return (
                <li key={c.id}>
                  {current ? (
                    <div className="candidate version-current" aria-current="true">
                      {body}
                    </div>
                  ) : (
                    <button type="button" className="candidate" disabled={busy} onClick={() => onPick(c)}>
                      {body}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {paged.pages > 1 && (
            <nav className="pager" aria-label="Versions pages">
              <button type="button" className="secondary" disabled={paged.page <= 1} onClick={() => go(paged.page - 1)}>
                <span aria-hidden="true">← </span>Previous
              </button>
              <span className="muted small" role="status">
                Page {paged.page} of {paged.pages}
              </span>
              <button type="button" className="secondary" disabled={paged.page >= paged.pages} onClick={() => go(paged.page + 1)}>
                Next<span aria-hidden="true"> →</span>
              </button>
            </nav>
          )}
        </div>
      )}
    </>
  );
}
