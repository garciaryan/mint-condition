"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { defaultLotName } from "../../lib/collection/ui.ts";
import { relativeTime } from "../../lib/relative-time.ts";
import type { Grade } from "../../lib/types.ts";
import DiscogsCredit from "../DiscogsCredit.tsx";
import GradeSelect from "../GradeSelect.tsx";
import { money } from "./[id]/api.ts";

type LotSummary = {
  id: number;
  name: string;
  updatedAt: number;
  itemCount: number;
  suggested: number;
  defaultRecord: Grade;
  defaultSleeve: Grade;
};

type ApiError = { status: "error"; kind: string; message: string };


async function readError(r: Response): Promise<string> {
  try {
    const body = (await r.json()) as Partial<ApiError>;
    return body.message ?? `Request failed (${r.status}).`;
  } catch {
    return `Request failed (${r.status}).`;
  }
}

export default function LotsList() {
  const router = useRouter();
  const [lots, setLots] = useState<LotSummary[] | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [name, setName] = useState("");
  const [record, setRecord] = useState<Grade>("VG+");
  const [sleeve, setSleeve] = useState<Grade>("VG+");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Prefill on the client so the date is the user's local one, not the server's.
  useEffect(() => setName(defaultLotName(new Date())), []);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoadError(null);
    (async () => {
      try {
        const r = await fetch("/api/sessions", { signal: ctrl.signal });
        if (r.status === 401) return location.assign("/login?next=/collection");
        if (!r.ok) return setLoadError(await readError(r));
        const body = (await r.json()) as { sessions: LotSummary[]; currency?: string };
        setLots(body.sessions);
        if (body.currency) setCurrency(body.currency);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setLoadError("Could not reach the server. Check your connection.");
      }
    })();
    return () => ctrl.abort();
  }, [attempt]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const r = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() || undefined, defaultRecord: record, defaultSleeve: sleeve }),
      });
      if (r.status === 401) return location.assign("/login?next=/collection");
      if (!r.ok) {
        setCreateError(await readError(r));
        return;
      }
      const lot = (await r.json()) as { id: number };
      router.push(`/collection/${lot.id}`);
      // Stay disabled until navigation replaces the page, so a second click cannot create a duplicate.
      return;
    } catch {
      setCreateError("Could not reach the server. Check your connection.");
    }
    setCreating(false);
  }

  return (
    <>
      <form className="card new-lot" onSubmit={create} noValidate>
        <h2>New collection</h2>
        <div className="new-lot-fields">
          <div className="field">
            <label htmlFor="lot-name">Collection name</label>
            <input
              id="lot-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              autoComplete="off"
              aria-describedby={createError ? "lot-create-error" : undefined}
            />
          </div>
          <div className="field">
            <label htmlFor="lot-record">Default record grade</label>
            <GradeSelect id="lot-record" value={record} onChange={setRecord} />
          </div>
          <div className="field">
            <label htmlFor="lot-sleeve">Default sleeve grade</label>
            <GradeSelect id="lot-sleeve" value={sleeve} onChange={setSleeve} />
          </div>
          <button type="submit" disabled={creating}>
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
        {createError && (
          <p className="field-error" id="lot-create-error" role="alert">
            <span aria-hidden="true">⚠ </span>
            {createError}
          </p>
        )}
      </form>

      <section aria-labelledby="lots-heading">
        <h2 id="lots-heading" className="sr-only">
          Your collections
        </h2>
        {loadError ? (
          <div className="card error" role="alert">
            <h2>Could not load collections</h2>
            <p>{loadError}</p>
            <button type="button" className="secondary" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </div>
        ) : lots === null ? (
          <div className="card muted loading" role="status">
            <span className="spinner" aria-hidden="true" />
            <span>Loading collections…</span>
          </div>
        ) : lots.length === 0 ? (
          <div className="card notice">
            <p>No collections yet. Create one to start pricing records together.</p>
          </div>
        ) : (
          <ul className="lots">
            {lots.map((lot) => (
              <li key={lot.id}>
                <Link href={`/collection/${lot.id}`} className="lot-row">
                  <span className="lot-name">{lot.name}</span>
                  <span className="lot-meta muted small">
                    <span>Updated {relativeTime(lot.updatedAt)}</span>
                    <span>
                      {lot.itemCount} {lot.itemCount === 1 ? "record" : "records"}
                    </span>
                  </span>
                  <span className="lot-total">
                    <small className="muted">Suggested</small>
                    {money(lot.suggested, currency)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {lots !== null && lots.length > 0 && <DiscogsCredit />}
      </section>
    </>
  );
}
