"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { DATA_CREDIT, dataExpired, MAX_CACHE_HOURS, releaseUrl } from "@/lib/discogs-terms.ts";
import { clearsInputs, fieldErrors, movesToResult } from "@/lib/form.ts";
import { relativeTime } from "@/lib/relative-time.ts";
import { withArtist } from "@/lib/versions.ts";
import type { FieldErrors } from "@/lib/form.ts";
import type { LookupResponse } from "@/lib/lookup.ts";
import { GRADE_NAMES } from "@/lib/types.ts";
import type { Candidate, Grade } from "@/lib/types.ts";
import DemandBadge from "@/components/ui/DemandBadge.tsx";
import GradeSelect from "@/components/ui/GradeSelect.tsx";
import Picker, { Thumb } from "@/components/lookup/Picker.tsx";
import ScanButton from "@/components/scan/ScanButton.tsx";
import VersionsPanel from "@/components/lookup/VersionsPanel.tsx";
import NavIcon from "@/components/layout/NavIcon.tsx";
import { ROUTES } from "@/lib/consts.ts";

// Loaded only when the scan icon is pressed, so the camera code and detector stay out of the page bundle.
const LookupScanner = dynamic(() => import("@/components/lookup/LookupScanner.tsx"), { ssr: false });

type Priced = Extract<LookupResponse, { status: "priced" | "no-price" }>;
type LookupError = Extract<LookupResponse, { status: "error" }>;

/** What the output area shows. `year` is the year that was searched, not whatever is in the form now. */
type View =
  | { kind: "idle" }
  | { kind: "candidates"; candidates: Candidate[]; year?: number }
  | { kind: "no-match"; year?: number }
  | { kind: "result"; res: Priced }
  | { kind: "error"; res: LookupError };

type Busy = null | "search" | "price";

export default function Lookup() {
  const [catno, setCatno] = useState("");
  const [year, setYear] = useState("");
  const [record, setRecord] = useState<Grade>("VG+");
  const [sleeve, setSleeve] = useState<Grade>("VG+");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [scanning, setScanning] = useState(false);
  const [scanUnavailable, setScanUnavailable] = useState<string | null>(null);

  const [view, setView] = useState<View>({ kind: "idle" });
  const [busy, setBusy] = useState<Busy>(null);
  const [slow, setSlow] = useState(false);
  // The pressing being priced, and the candidate list it came from (for "back to pressings").
  const [release, setRelease] = useState<Candidate | null>(null);
  const [releaseId, setReleaseId] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<Extract<View, { kind: "candidates" }> | null>(null);
  // catno|year of the last search, so re-submitting an unchanged search re-prices instead of searching again.
  const [searchedKey, setSearchedKey] = useState<string | null>(null);

  const inflight = useRef<AbortController | null>(null);
  // A pick that hasn't come back yet; grade changes re-price it rather than the older result.
  const pending = useRef<{ id: number; picked: Candidate | null } | null>(null);
  const retry = useRef<(() => void) | null>(null);
  const focusNext = useRef(false);
  const outputRef = useRef<HTMLElement>(null);
  const catnoRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);

  // Take the user to the new heading after navigation-like changes (search, pick, back); not on in-place re-prices.
  // Scrolls explicitly (focus alone doesn't reliably scroll on mobile Safari) and waits for the scanner to close.
  useEffect(() => {
    if (!movesToResult({ pending: focusNext.current, scannerOpen: scanning })) return;
    focusNext.current = false;
    const heading = outputRef.current?.querySelector<HTMLElement>("[data-focus]");
    if (!heading) return;
    heading.focus({ preventScroll: true });
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    heading.scrollIntoView({ block: "start", behavior: reduced ? "auto" : "smooth" });
  }, [view, scanning]);

  async function lookup(body: Record<string, unknown>, what: "search" | "price"): Promise<LookupResponse | null> {
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    setBusy(what);
    setSlow(false);
    const slowTimer = setTimeout(() => setSlow(true), 4000);
    try {
      const r = await fetch("/api/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const res = (await r.json()) as LookupResponse;
      if (res.status === "error" && res.kind === "auth") {
        location.assign(ROUTES.login(ROUTES.home));
        return null;
      }
      return res;
    } catch (e) {
      if (ctrl.signal.aborted) return null;
      return { status: "error", kind: "upstream", message: `Could not reach the local server (${e instanceof Error ? e.message : e}).` };
    } finally {
      clearTimeout(slowTimer);
      if (inflight.current === ctrl) setBusy(null);
    }
  }

  function show(res: LookupResponse, search?: { year?: number }) {
    if (res.status === "error") setView({ kind: "error", res });
    else if (res.status === "no-match") setView({ kind: "no-match", year: search?.year });
    else if (res.status === "candidates") setView({ kind: "candidates", candidates: res.candidates, year: search?.year });
    else setView({ kind: "result", res });
  }

  async function price(
    id: number,
    picked: Candidate | null,
    opts: { grades?: { record: Grade; sleeve: Grade }; focus?: boolean; fresh?: boolean; clear?: boolean } = {},
  ) {
    const grades = opts.grades ?? { record, sleeve };
    pending.current = { id, picked };
    retry.current = () => void price(id, picked, { grades, focus: true, fresh: opts.fresh });
    const res = await lookup({ releaseId: id, ...grades, ...(opts.fresh ? { fresh: true } : {}) }, "price");
    if (!res) return;
    pending.current = null;
    setReleaseId(id);
    setRelease(picked);
    if (opts.focus) focusNext.current = true;
    show(res);
    if (opts.clear && clearsInputs(res.status)) clearInputs();
  }

  // Ready for the next record; grades and the shown result stay.
  function clearInputs() {
    setCatno("");
    setYear("");
    setErrors({});
  }

  async function search(fresh = false, q: { catno: string; year: string } = { catno, year }) {
    const key = `${q.catno.trim()}|${q.year.trim()}`;
    const searchedYear = Number(q.year) || undefined;
    retry.current = () => void search(fresh, q);
    pending.current = null;
    const res = await lookup({ catno: q.catno, year: q.year, record, sleeve, ...(fresh ? { fresh: true } : {}) }, "search");
    if (!res) return;
    setSearchedKey(res.status === "error" ? null : key);
    setCandidates(res.status === "candidates" ? { kind: "candidates", candidates: res.candidates, year: searchedYear } : null);
    if (res.status === "priced" || res.status === "no-price") {
      setReleaseId(res.releaseId);
      setRelease(res.release);
    } else {
      setReleaseId(null);
      setRelease(null);
    }
    focusNext.current = true;
    show(res, { year: searchedYear });
    if (clearsInputs(res.status)) clearInputs();
  }

  // The scanner fades out by itself and then calls onClose.
  function onScanned(code: string) {
    setCatno(code);
    setErrors({});
    void search(false, { catno: code, year });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const errs = fieldErrors(catno, year);
    setErrors(errs);
    if (errs.catno) return catnoRef.current?.focus();
    if (errs.year) return yearRef.current?.focus();
    const key = `${catno.trim()}|${year.trim()}`;
    if (key === searchedKey && releaseId !== null) void price(releaseId, release, { focus: true });
    else void search();
  }

  /** Re-prices the shown (or still-loading) pressing in place, e.g. after a grade change. */
  function reprice(opts: { grades?: { record: Grade; sleeve: Grade }; fresh?: boolean; focus?: boolean }) {
    if (busy === "search") return;
    const target = pending.current ?? (view.kind === "result" && releaseId !== null ? { id: releaseId, picked: release } : null);
    if (target) void price(target.id, target.picked, opts);
  }

  function changeGrade(which: "record" | "sleeve", g: Grade) {
    const grades = { record, sleeve, [which]: g };
    if (which === "record") setRecord(g);
    else setSleeve(g);
    reprice({ grades });
  }

  function validateField(which: keyof FieldErrors) {
    setErrors((prev) => ({ ...prev, [which]: fieldErrors(catno, year)[which] }));
  }

  const statusText =
    busy === "search"
      ? "Searching Discogs…"
      : busy === "price"
        ? "Fetching prices…"
        : view.kind === "candidates"
          ? `${view.candidates.length} possible pressings found.`
          : view.kind === "no-match"
            ? "No pressings found."
            : view.kind === "result"
              ? view.res.status === "priced"
                ? "Prices updated."
                : "No price data for this release."
              : "";
  const repricing = busy === "price" && view.kind === "result";

  return (
    <>
      <form className="card form" onSubmit={onSubmit} noValidate>
        <div className="field catno">
          <label htmlFor="catno">
            Catalog number or barcode <span className="req" aria-hidden="true">*</span>
          </label>
          <div className="input-row">
            <input
              id="catno"
              ref={catnoRef}
              value={catno}
              onChange={(e) => setCatno(e.target.value)}
              onBlur={() => errors.catno && validateField("catno")}
              placeholder="SD 7208 or 075678135812"
              enterKeyHint="search"
              autoFocus
              required
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={errors.catno ? true : undefined}
              aria-describedby={errors.catno ? "catno-error" : undefined}
            />
            <ScanButton onScan={() => setScanning(true)} unavailable={scanUnavailable} />
          </div>
          {errors.catno && (
            <p className="field-error" id="catno-error">
              {errors.catno}
            </p>
          )}
        </div>
        <div className="field year">
          <label htmlFor="year">Pressing year</label>
          <input
            id="year"
            ref={yearRef}
            value={year}
            onChange={(e) => setYear(e.target.value)}
            onBlur={() => validateField("year")}
            placeholder="1971"
            inputMode="numeric"
            maxLength={4}
            aria-invalid={errors.year ? true : undefined}
            aria-describedby={errors.year ? "year-error" : undefined}
          />
          {errors.year && (
            <p className="field-error" id="year-error">
              {errors.year}
            </p>
          )}
        </div>
        <div className="field">
          <label htmlFor="record">Record grade</label>
          <GradeSelect id="record" value={record} onChange={(g) => changeGrade("record", g)} />
        </div>
        <div className="field">
          <label htmlFor="sleeve">Sleeve grade</label>
          <GradeSelect id="sleeve" value={sleeve} onChange={(g) => changeGrade("sleeve", g)} />
        </div>
        <div className="form-row">
          <button type="submit" disabled={busy !== null}>
            {busy !== null ? "Looking up…" : "Price it"}
          </button>
        </div>
      </form>
      {scanning && (
        <LookupScanner
          onCode={onScanned}
          onClose={() => setScanning(false)}
          onUnavailable={() => setScanUnavailable("This browser can't read barcodes. Type the number instead.")}
        />
      )}

      <p className="sr-only" role="status">
        {statusText}
      </p>

      <section className="output" ref={outputRef}>
        {busy !== null && !repricing && (
          <div className="card muted loading">
            <span className="spinner" aria-hidden="true" />
            <span>
              {busy === "search" ? "Searching Discogs…" : "Fetching prices…"}
              {slow && " Discogs is slow or rate-limiting; still waiting."}
            </span>
          </div>
        )}
        {(busy === null || repricing) && (
          <>
            {view.kind === "no-match" && (
              <div className="card notice">
                <h2 tabIndex={-1} data-focus>
                  No pressings found
                </h2>
                <p>
                  Nothing on Discogs matches that catalog number or barcode
                  {view.year ? ` within a year of ${view.year}` : ""}. Check the catno against the label or spine (or the
                  barcode digits), or clear the year to widen the search.
                </p>
                <p>
                  Added it to Discogs just now?{" "}
                  <button type="button" className="link" onClick={() => void search(true)} disabled={busy !== null}>
                    Search Discogs again
                  </button>
                </p>
              </div>
            )}
            {view.kind === "error" && <ErrorCard res={view.res} onRetry={() => retry.current?.()} />}
            {view.kind === "candidates" && (
              <Picker candidates={view.candidates} query={searchedKey?.split("|")[0] ?? catno} year={view.year} onPick={(c) => void price(c.id, c, { focus: true, clear: true })} />
            )}
            {view.kind === "result" && (
              <ResultCard
                res={view.res}
                release={view.res.release ?? release}
                busy={repricing}
                slow={repricing && slow}
                onRefresh={() => reprice({ fresh: true, focus: true })}
                onPick={(c) => void price(c.id, c, { focus: true })}
                onBack={
                  candidates
                    ? () => {
                        focusNext.current = true;
                        setView(candidates);
                      }
                    : undefined
                }
              />
            )}
          </>
        )}
      </section>
    </>
  );
}

function ErrorCard({ res, onRetry }: { res: LookupError; onRetry: () => void }) {
  const titles: Record<typeof res.kind, string> = {
    "bad-request": "Check the form",
    "missing-env": "Setup needed",
    "not-connected": "Discogs not connected",
    settings: "Settings problem",
    database: "Database unavailable",
    "bad-token": "Discogs rejected the token",
    "rate-limited": "Rate-limited by Discogs",
    upstream: "Lookup failed",
    auth: "Signed out",
    forbidden: "Request blocked",
  };
  const retryable = res.kind === "rate-limited" || res.kind === "upstream" || res.kind === "database";
  return (
    <div className="card error" role="alert">
      <h2 tabIndex={-1} data-focus>
        {titles[res.kind] ?? "Lookup failed"}
      </h2>
      <p>{res.message}</p>
      {retryable && (
        <button type="button" className="secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

function ResultCard({
  res,
  release,
  busy,
  slow,
  onRefresh,
  onPick,
  onBack,
}: {
  res: Priced;
  release: Candidate | null;
  busy: boolean;
  slow: boolean;
  onRefresh: () => void;
  /** Re-prices another version of the same master, like a pick. */
  onPick: (c: Candidate) => void;
  onBack?: () => void;
}) {
  const cur = res.currency;
  const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(n);

  // Discogs terms: nothing shown more than 6 hours behind discogs.com. A card left open that long hides its figures.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const wait = res.fetchedAt + MAX_CACHE_HOURS * 3_600_000 - Date.now() + 1000;
    if (wait <= 0) return;
    const t = setTimeout(() => setNow(Date.now()), wait);
    return () => clearTimeout(t);
  }, [res.fetchedAt]);
  const expired = dataExpired(res.fetchedAt, now);

  return (
    <div className={busy ? "card result stale" : "card result"} aria-busy={busy}>
      {onBack && (
        <button type="button" className="link back" onClick={onBack}>
          <span aria-hidden="true">← </span>Other pressings
        </button>
      )}
      <div className="result-head">
        <Thumb src={release?.thumb ?? null} />
        <div className="result-title">
          <h2 tabIndex={-1} data-focus>
            {release?.title ?? `Release ${res.releaseId}`}
          </h2>
          {release && (
            <p className="muted">
              {[release.label, release.catno, release.country, release.year, release.format].filter(Boolean).join(" · ")}
            </p>
          )}
          <p>
            <a href={releaseUrl(res.releaseId)} target="_blank" rel="noreferrer">
              {DATA_CREDIT}<span aria-hidden="true"> ↗</span>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
          {res.cached && !expired && (
            <p className="muted small price-age">
              {res.status === "priced" ? "Prices from" : "Checked"} {relativeTime(res.fetchedAt)}
              <button
                type="button"
                className="icon-button refresh"
                onClick={onRefresh}
                disabled={busy}
                aria-busy={busy}
                aria-label="Refresh prices"
                title="Refresh prices"
              >
                <NavIcon name="refresh" />
              </button>
            </p>
          )}
        </div>
        {busy && (
          <span className="updating muted small">
            <span className="spinner" aria-hidden="true" />
            {slow ? "Still waiting on Discogs…" : "Updating…"}
          </span>
        )}
      </div>
      {!expired && res.stats.masterId ? (
        <VersionsPanel
          key={res.releaseId}
          masterId={res.stats.masterId}
          releaseId={res.releaseId}
          fallbackYear={release?.year ?? null}
          busy={busy}
          onPick={(c) => onPick({ ...c, title: withArtist(release?.title, c.title) })}
        />
      ) : null}

      {expired ? (
        <div className="notice">
          <p>
            These figures are more than {MAX_CACHE_HOURS} hours old, so they’re hidden (Discogs only allows showing current
            data).{" "}
            <button type="button" className="link" onClick={onRefresh} disabled={busy}>
              Refresh prices
            </button>
          </p>
        </div>
      ) : res.status === "no-price" ? (
        <div className="notice">
          {res.reason === "no-suggestions" ? (
            <p>
              Discogs has no price suggestions for this release. Either nobody has priced it yet, or your Discogs seller
              settings aren’t complete (price suggestions need a seller account with a payment method set up).
            </p>
          ) : (
            <p>Discogs has suggestions for this release, but not for the record grade you picked. Try a neighbouring grade.</p>
          )}
        </div>
      ) : (
        <div className="prices">
          <div className="price-block market">
            <div className="price-head">
              <h3>Market value</h3>
              <DemandBadge demand={res.demand} have={res.stats.have} want={res.stats.want} forSale={res.stats.numForSale} />
            </div>
            <div className="range">
              <span>
                <small>Low</small>
                {money(res.result.market.low)}
              </span>
              <span className="big">
                <small>Suggested</small>
                {money(res.result.market.suggested)}
              </span>
              <span>
                <small>High</small>
                {money(res.result.market.high)}
              </span>
            </div>
            <p className="muted small">
              {GRADE_NAMES[res.result.record]} suggestion {money(res.result.market.basePrice)} × sleeve{" "}
              {res.result.sleeve} ×{res.result.market.sleeveMultiplier}
            </p>
          </div>
          <div className="price-block">
            <h3>Sell price</h3>
            <div className="big">{money(res.result.sell.price)}</div>
            <p className="muted small">You'd net {money(res.result.sell.net)} on Discogs after the seller fee.</p>
            {res.result.sell.aboveLowestListing && (
              <p className="warn small">
                Above the cheapest current listing ({money(res.stats.lowestPrice!)}), which may be a worse copy.
              </p>
            )}
          </div>
        </div>
      )}

      {!expired && (
        <dl className="stats">
          <div>
            <dt>Copies for sale</dt>
            <dd>{res.stats.numForSale}</dd>
          </div>
          <div>
            <dt>Lowest listing</dt>
            <dd>{res.stats.lowestPrice === null ? "none" : money(res.stats.lowestPrice)}</dd>
          </div>
          {res.stats.have !== undefined && res.stats.want !== undefined && (
            <div>
              <dt>Want / have</dt>
              <dd>
                {res.stats.want.toLocaleString("en-US")} / {res.stats.have.toLocaleString("en-US")}
              </dd>
            </div>
          )}
        </dl>
      )}
      <p className="muted small">
        Discogs figures are asking prices and suggestions, not confirmed sales. Treat them as a guide.
      </p>
    </div>
  );
}
