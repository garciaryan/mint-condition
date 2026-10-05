"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { fieldErrors } from "../lib/form.ts";
import type { FieldErrors } from "../lib/form.ts";
import type { LookupResponse } from "../lib/lookup.ts";
import { GRADE_NAMES } from "../lib/types.ts";
import type { Candidate, Grade } from "../lib/types.ts";
import GradeSelect from "./GradeSelect.tsx";
import Picker, { Thumb } from "./Picker.tsx";

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
  const [local, setLocal] = useState(false);
  const [areaCode, setAreaCode] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  const [view, setView] = useState<View>({ kind: "idle" });
  const [busy, setBusy] = useState<Busy>(null);
  const [slow, setSlow] = useState(false);
  // The pressing being priced, and the candidate list it came from (for "back to pressings").
  const [release, setRelease] = useState<Candidate | null>(null);
  const [releaseId, setReleaseId] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<Extract<View, { kind: "candidates" }> | null>(null);
  // catno|year of the last search, so re-submitting an unchanged search re-prices instead of searching again.
  const [searchedKey, setSearchedKey] = useState<string | null>(null);
  // Area code the shown prices were computed with, so editing it re-prices.
  const [pricedArea, setPricedArea] = useState("");

  const inflight = useRef<AbortController | null>(null);
  // A pick that hasn't come back yet; grade changes re-price it rather than the older result.
  const pending = useRef<{ id: number; picked: Candidate | null } | null>(null);
  const retry = useRef<(() => void) | null>(null);
  const focusNext = useRef(false);
  const outputRef = useRef<HTMLElement>(null);
  const catnoRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);

  // Move focus to the new heading after navigation-like changes (search, pick, back); not on in-place re-prices.
  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    outputRef.current?.querySelector<HTMLElement>("[data-focus]")?.focus();
  }, [view]);

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
        location.assign("/login?next=/");
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
    opts: { grades?: { record: Grade; sleeve: Grade }; area?: string; focus?: boolean } = {},
  ) {
    const grades = opts.grades ?? { record, sleeve };
    const area = opts.area ?? (local ? areaCode.trim() : "");
    pending.current = { id, picked };
    retry.current = () => void price(id, picked, { grades, area, focus: true });
    const res = await lookup({ releaseId: id, ...grades, areaCode: area }, "price");
    if (!res) return;
    pending.current = null;
    setReleaseId(id);
    setRelease(picked);
    setPricedArea(area);
    if (opts.focus) focusNext.current = true;
    show(res);
  }

  async function search() {
    const key = `${catno.trim()}|${year.trim()}`;
    const searchedYear = Number(year) || undefined;
    const area = local ? areaCode.trim() : "";
    retry.current = () => void search();
    pending.current = null;
    const res = await lookup({ catno, year, record, sleeve, areaCode: area }, "search");
    if (!res) return;
    setSearchedKey(res.status === "error" ? null : key);
    setCandidates(res.status === "candidates" ? { kind: "candidates", candidates: res.candidates, year: searchedYear } : null);
    if (res.status === "priced" || res.status === "no-price") {
      setReleaseId(res.releaseId);
      setRelease(res.release);
      setPricedArea(area);
    } else {
      setReleaseId(null);
      setRelease(null);
    }
    focusNext.current = true;
    show(res, { year: searchedYear });
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

  /** Re-prices the shown (or still-loading) pressing in place, e.g. after a grade or area code change. */
  function reprice(opts: { grades?: { record: Grade; sleeve: Grade }; area?: string }) {
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

  function changeArea() {
    const area = areaCode.trim();
    if (area !== pricedArea) reprice({ area });
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
          <label className="toggle">
            <input
              type="checkbox"
              checked={local}
              onChange={(e) => {
                setLocal(e.target.checked);
                if (e.target.checked && areaCode.trim()) changeArea();
              }}
            />
            <span>Local sale</span>
          </label>
          {local && (
            <div className="field inline">
              <label htmlFor="area">Area code</label>
              <input
                id="area"
                value={areaCode}
                onChange={(e) => setAreaCode(e.target.value)}
                onBlur={changeArea}
                placeholder="optional"
                inputMode="numeric"
                size={6}
              />
            </div>
          )}
          <button type="submit" disabled={busy !== null}>
            {busy !== null ? "Looking up…" : "Price it"}
          </button>
        </div>
      </form>

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
              </div>
            )}
            {view.kind === "error" && <ErrorCard res={view.res} onRetry={() => retry.current?.()} />}
            {view.kind === "candidates" && (
              <Picker candidates={view.candidates} year={view.year} onPick={(c) => void price(c.id, c, { focus: true })} />
            )}
            {view.kind === "result" && (
              <ResultCard
                res={view.res}
                release={view.res.release ?? release}
                showLocal={local}
                busy={repricing}
                slow={repricing && slow}
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
    settings: "Settings problem",
    "bad-token": "Discogs rejected the token",
    "rate-limited": "Rate-limited by Discogs",
    upstream: "Lookup failed",
    auth: "Signed out",
    forbidden: "Request blocked",
  };
  const retryable = res.kind === "rate-limited" || res.kind === "upstream";
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
  showLocal,
  busy,
  slow,
  onBack,
}: {
  res: Priced;
  release: Candidate | null;
  showLocal: boolean;
  busy: boolean;
  slow: boolean;
  onBack?: () => void;
}) {
  const discogsUrl = `https://www.discogs.com/release/${res.releaseId}`;
  const cur = res.status === "priced" ? res.currency : (res.stats.currency ?? "USD");
  const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(n);

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
            <a href={discogsUrl} target="_blank" rel="noreferrer">
              View on Discogs<span aria-hidden="true"> ↗</span>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
        </div>
        {busy && (
          <span className="updating muted small">
            <span className="spinner" aria-hidden="true" />
            {slow ? "Still waiting on Discogs…" : "Updating…"}
          </span>
        )}
      </div>

      {res.status === "no-price" ? (
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
        <div className={showLocal ? "prices with-local" : "prices"}>
          <div className="price-block market">
            <h3>Market value</h3>
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
            {res.result.sell.aboveLowestListing && (
              <p className="warn small">
                Above the cheapest current listing ({money(res.stats.lowestPrice!)}), which may be a worse copy.
              </p>
            )}
          </div>
          {showLocal && (
            <div className="price-block">
              <h3>Local sale</h3>
              <div className="big">{money(res.result.local.price)}</div>
              <p className="muted small">
                Region ×{res.result.local.regionMultiplier}. Selling on Discogs instead nets{" "}
                {money(res.result.local.discogsNet)} after fees.
              </p>
            </div>
          )}
        </div>
      )}

      <dl className="stats">
        <div>
          <dt>Copies for sale</dt>
          <dd>{res.stats.numForSale}</dd>
        </div>
        <div>
          <dt>Lowest listing</dt>
          <dd>{res.stats.lowestPrice === null ? "none" : money(res.stats.lowestPrice)}</dd>
        </div>
      </dl>
      <p className="muted small">
        Discogs figures are asking prices and suggestions, not confirmed sales. Treat them as a guide.
      </p>
    </div>
  );
}
