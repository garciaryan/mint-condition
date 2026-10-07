"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { SLEEVE_HELP, settingHelp } from "@/lib/settings-help.ts";
import { FIELD_KEYS, formatDefault, formView, fromForm, parseLadder, toForm } from "@/lib/settings-form.ts";
import type { FieldKey, SettingsForm as Form } from "@/lib/settings-form.ts";
import { GRADES } from "@/lib/types.ts";
import type { Settings } from "@/lib/types.ts";
import HelpTip from "@/app/settings/HelpTip.tsx";
import { ROUTES } from "@/lib/consts.ts";

type State = {
  settings: Settings;
  defaults: Settings;
  saved: boolean;
  updatedAt: number | null;
  invalid: string | null;
  savedRaw: unknown;
};
type ApiError = { status: "error"; kind: string; message: string; field?: string };
type Errors = Partial<Record<FieldKey, string>>;

const LABELS: Partial<Record<FieldKey, string>> = {
  "sell.undercutPercent": "Undercut (%)",
  "sell.floor": "Minimum sell price ($)",
  "sell.discogsFeePercent": "Discogs fee (%)",
  "offer.ladderPercents": "Offer ladder (% of suggested)",
  "offer.openingPercent": "Opening offer (%)",
  "offer.marginPercent": "Margin (%)",
  "offer.overheadPerRecord": "Overhead per record ($)",
  "offer.pickThreshold": "Pick threshold ($)",
  "offer.bulkEach": "Bulk price each ($)",
  "offer.unverifiedSteps": "Unverified steps (1–3)",
  "discogs.cacheHours": "Cache prices for (hours)",
};
const label = (k: FieldKey) => LABELS[k] ?? `${k.split(".")[1]} sleeve (%)`;

// The sleeve grid shares one help note, on its heading; each sleeve input points at it too.
const SLEEVE_HELP_ID = "sleeve-help";

const SECTIONS: { legend: string; note?: string; help?: string; grid?: boolean; currency?: boolean; keys: FieldKey[] }[] = [
  { legend: "Selling", keys: ["sell.undercutPercent", "sell.floor", "sell.discogsFeePercent"] },
  {
    legend: "Sleeve condition",
    note: "Share of market value kept for each sleeve grade.",
    help: SLEEVE_HELP,
    grid: true,
    keys: GRADES.map((g) => `sleeveMultipliers.${g}` as FieldKey),
  },
  {
    legend: "Offers",
    keys: [
      "offer.ladderPercents", "offer.openingPercent", "offer.marginPercent", "offer.overheadPerRecord",
      "offer.pickThreshold", "offer.bulkEach", "offer.unverifiedSteps",
    ],
  },
  {
    legend: "Discogs",
    note: "Discogs answers are reused for this long, at most 6 hours (Discogs terms). Re-price and Refresh always fetch fresh. 0 turns the cache off.",
    currency: true,
    keys: ["discogs.cacheHours"],
  },
];

const OFFLINE = "Could not reach the server. Check your connection.";
const SIGNED_OUT = "Signed out. Log in again.";

async function readError(r: Response): Promise<ApiError> {
  try {
    const body = (await r.json()) as Partial<ApiError>;
    return { status: "error", kind: body.kind ?? "unknown", message: body.message ?? `Request failed (${r.status}).`, field: body.field };
  } catch {
    return { status: "error", kind: "unknown", message: `Request failed (${r.status}).` };
  }
}

const sameForm = (a: Form, b: Form) => FIELD_KEYS.every((k) => a[k].trim() === b[k].trim());

export default function SettingsForm() {
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [form, setForm] = useState<Form | null>(null);
  const [loaded, setLoaded] = useState<Form | null>(null);
  const [saveable, setSaveable] = useState(false);
  const [touched, setTouched] = useState<Set<FieldKey>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const focusAfter = useRef<FieldKey | null>(null);

  function apply(s: State) {
    const view = formView(s);
    setState(s);
    setForm(view.form);
    setLoaded(view.form);
    setSaveable(view.saveable);
    setTouched(new Set());
    setSubmitted(view.showErrors);
    setServerErrors({});
    setFormError(null);
  }

  useEffect(() => {
    const ctrl = new AbortController();
    setLoadError(null);
    (async () => {
      try {
        const r = await fetch("/api/settings", { signal: ctrl.signal });
        if (r.status === 401) return location.assign(ROUTES.login(ROUTES.settings));
        if (!r.ok) return setLoadError((await readError(r)).message);
        apply((await r.json()) as State);
      } catch {
        if (!ctrl.signal.aborted) setLoadError(OFFLINE);
      }
    })();
    return () => ctrl.abort();
  }, [attempt]);

  const dirty = form !== null && loaded !== null && !sameForm(form, loaded);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    // In-app links navigate client-side, so beforeunload never fires for them; ask here instead.
    const guard = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.defaultPrevented) return;
      const link = (e.target as Element | null)?.closest?.("a");
      if (!link || link.hasAttribute("target") || !link.href) return;
      if (new URL(link.href).origin !== location.origin) return;
      if (!confirm("You have unsaved changes. Leave without saving?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", guard, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", guard, true);
    };
  }, [dirty]);

  useEffect(() => {
    if (focusAfter.current) {
      document.getElementById(focusAfter.current)?.focus();
      focusAfter.current = null;
    }
  });

  if (loadError) {
    return (
      <div className="card error" role="alert">
        <h2>Could not load settings</h2>
        <p>{loadError}</p>
        <button type="button" className="secondary" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </div>
    );
  }
  if (!state || !form) {
    return (
      <div className="card muted loading" role="status">
        <span className="spinner" aria-hidden="true" />
        <span>Loading settings…</span>
      </div>
    );
  }

  const checked = fromForm(form);
  const clientErrors: Errors = checked.ok ? {} : checked.errors;
  const errorFor = (k: FieldKey) => serverErrors[k] ?? (submitted || touched.has(k) ? clientErrors[k] : undefined);

  function edit(k: FieldKey, value: string) {
    setForm((f) => (f ? { ...f, [k]: value } : f));
    setServerErrors(({ [k]: _drop, ...rest }) => rest);
    setStatus("");
  }

  async function send(method: "PUT" | "DELETE", body?: unknown) {
    setBusy(true);
    setFormError(null);
    setSignedOut(false);
    setStatus("");
    try {
      const r = await fetch("/api/settings", {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (r.status === 401) {
        setSignedOut(true);
        return;
      }
      if (!r.ok) {
        const err = await readError(r);
        if (err.field && (FIELD_KEYS as readonly string[]).includes(err.field)) {
          setServerErrors({ [err.field as FieldKey]: err.message.replace(/^settings: /, "") });
          focusAfter.current = err.field as FieldKey;
        } else {
          setFormError(err.message);
        }
        return;
      }
      apply((await r.json()) as State);
      setStatus(method === "PUT" ? "Saved. Prices and collections use these now." : "Reset to defaults.");
    } catch {
      setFormError(OFFLINE);
    } finally {
      setBusy(false);
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    if (busy || !(dirty || saveable)) return;
    setSubmitted(true);
    if (!checked.ok) {
      focusAfter.current = FIELD_KEYS.find((k) => checked.errors[k]) ?? null;
      setStatus("");
      return;
    }
    void send("PUT", checked.value);
  }

  function reset() {
    if (busy || !confirm("Reset every setting to its default?")) return;
    void send("DELETE");
  }

  const ladder = parseLadder(form["offer.ladderPercents"]);
  const openingOptions = ladder.ok ? ladder.value.map(String) : [form["offer.openingPercent"]];
  if (!openingOptions.includes(form["offer.openingPercent"])) openingOptions.unshift(form["offer.openingPercent"]);

  function field(k: FieldKey) {
    const error = errorFor(k);
    const def = formatDefault(k, state!.defaults);
    const showDefault = form![k].trim() !== toForm(state!.defaults)[k];
    const hintId = `${k}-hint`;
    const errId = `${k}-error`;
    const help = settingHelp(k);
    const helpId = help ? `${k}-help` : SLEEVE_HELP_ID;
    const describedBy = [helpId, showDefault ? hintId : null, error ? errId : null].filter(Boolean).join(" ");
    const common = {
      id: k,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": describedBy,
      onBlur: () => setTouched((t) => new Set(t).add(k)),
    };
    return (
      <div className="field" key={k}>
        <div className="field-label">
          <label htmlFor={k}>{label(k)}</label>
          {help && <HelpTip id={helpId} label={label(k)} text={help} />}
        </div>
        {k === "offer.openingPercent" ? (
          <select {...common} value={form![k]} onChange={(e) => edit(k, e.target.value)}>
            {openingOptions.map((o) => (
              <option key={o} value={o}>
                {o === "" ? "—" : `${o}%`}
              </option>
            ))}
          </select>
        ) : (
          <input
            {...common}
            value={form![k]}
            onChange={(e) => edit(k, e.target.value)}
            inputMode={
              k === "offer.ladderPercents" ? "text" : k === "offer.unverifiedSteps" || k === "discogs.cacheHours" ? "numeric" : "decimal"
            }
            autoComplete="off"
          />
        )}
        {showDefault && (
          <span className="field-hint muted" id={hintId}>
            Default: {def}
          </span>
        )}
        {error && (
          <p className="field-error" id={errId}>
            <span aria-hidden="true">⚠ </span>
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <form className="settings" onSubmit={save} noValidate>
      {state.invalid && (
        <div className="card error" role="alert">
          <p>
            Your saved settings no longer pass a check ({state.invalid}). Prices are using the defaults until you fix
            and save, or reset.
          </p>
        </div>
      )}
      {SECTIONS.map((s) => (
        <fieldset className="card settings-section" key={s.legend} disabled={busy}>
          <legend className={s.help ? "with-help" : undefined}>
            {s.legend}
            {s.help && <HelpTip id={SLEEVE_HELP_ID} label={s.legend} text={s.help} />}
          </legend>
          {s.note && <p className="muted small">{s.note}</p>}
          <div className={s.grid ? "settings-grid sleeve" : "settings-grid"}>{s.keys.map(field)}</div>
          {s.currency && (
            <p className="settings-currency">
              <strong>Currency:</strong> {state.settings.discogs.currency} (follows your Discogs seller account)
            </p>
          )}
        </fieldset>
      ))}
      <div className="settings-actions">
        <button type="submit" disabled={busy || !(dirty || saveable)}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="secondary" onClick={reset} disabled={busy || (!state.saved && !dirty)}>
          Reset to defaults
        </button>
      </div>
      <p className="settings-status" role="status">
        {status}
      </p>
      {signedOut && (
        <p className="field-error" role="alert">
          {SIGNED_OUT} <a href={ROUTES.login(ROUTES.settings)}>Log in</a>
        </p>
      )}
      {formError && (
        <p className="field-error" role="alert">
          <span aria-hidden="true">⚠ </span>
          {formError}
        </p>
      )}
    </form>
  );
}
