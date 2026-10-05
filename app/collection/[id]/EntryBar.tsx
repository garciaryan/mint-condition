"use client";

import { useState } from "react";
import type { FormEvent, RefObject } from "react";
import type { NewLine } from "../../../lib/collection/types.ts";
import type { Grade } from "../../../lib/types.ts";
import GradeSelect from "../../GradeSelect.tsx";
import { api } from "./api.ts";
import PasteList from "./PasteList.tsx";

export default function EntryBar({
  sessionId,
  defaultRecord,
  defaultSleeve,
  queryRef,
  onAdded,
}: {
  sessionId: number;
  defaultRecord: Grade;
  defaultSleeve: Grade;
  queryRef: RefObject<HTMLInputElement | null>;
  onAdded: () => void;
}) {
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("");
  // Grades are lot-wide defaults that stay put between adds.
  const [record, setRecord] = useState<Grade>(defaultRecord);
  const [sleeve, setSleeve] = useState<Grade>(defaultSleeve);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);

  async function post(lines: NewLine[]): Promise<string | null> {
    const res = await api(`/api/sessions/${sessionId}/items`, "POST", { lines, record, sleeve });
    if (!res.ok) return res.message;
    onAdded();
    return null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const q = query.trim();
    if (!q) {
      setError("Enter a catalog number or barcode.");
      queryRef.current?.focus();
      return;
    }
    const y = year.trim();
    if (y && !(/^\d{4}$/.test(y) && Number(y) >= 1890 && Number(y) <= 2100)) {
      setError("Year must be four digits between 1890 and 2100, or left blank.");
      return;
    }
    setBusy(true);
    setError(null);
    const line: NewLine = y ? { query: q, year: Number(y) } : { query: q };
    const err = await post([line]);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setQuery("");
    setYear("");
    queryRef.current?.focus();
  }

  return (
    <section className="card entry" aria-label="Add records">
      <form onSubmit={submit} noValidate>
        <div className="entry-grid">
          <div className="field">
            <label htmlFor="entry-query">Catalog number or barcode</label>
            <input
              id="entry-query"
              ref={queryRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={64}
              autoComplete="off"
              autoCapitalize="characters"
              autoFocus
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "entry-error" : undefined}
            />
          </div>
          <div className="field">
            <label htmlFor="entry-year">Year</label>
            <input
              id="entry-year"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              inputMode="numeric"
              maxLength={4}
              autoComplete="off"
              placeholder="optional"
              aria-invalid={error && year ? true : undefined}
            />
          </div>
          <div className="field">
            <label htmlFor="entry-record">Record</label>
            <GradeSelect id="entry-record" value={record} onChange={setRecord} />
          </div>
          <div className="field">
            <label htmlFor="entry-sleeve">Sleeve</label>
            <GradeSelect id="entry-sleeve" value={sleeve} onChange={setSleeve} />
          </div>
          <div className="entry-buttons">
            {/* Task 7 wires the scanner and removes `hidden`. */}
            <button type="button" className="secondary" hidden>
              Scan
            </button>
            <button type="submit" disabled={busy}>
              {busy ? "Adding…" : "Add"}
            </button>
          </div>
        </div>
        {error && (
          <p className="field-error" id="entry-error" role="alert">
            <span aria-hidden="true">⚠ </span>
            {error}
          </p>
        )}
      </form>
      <div className="entry-foot">
        <button type="button" className="link" aria-expanded={pasteOpen} aria-controls="paste-panel" onClick={() => setPasteOpen((o) => !o)}>
          Paste a list
        </button>
        <span className="hint muted small">
          <kbd>Enter</kbd> adds and clears for the next record · grades stay as set
        </span>
      </div>
      {pasteOpen && (
        <div id="paste-panel">
          <PasteList onAdd={post} />
        </div>
      )}
    </section>
  );
}
