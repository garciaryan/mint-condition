"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import type { NewLine } from "@/lib/collection/types.ts";
import type { ItemView } from "@/lib/collection/view.ts";
import type { Grade } from "@/lib/types.ts";
import GradeSelect from "@/components/ui/GradeSelect.tsx";
import ScanButton from "@/components/scan/ScanButton.tsx";
import { createSerialQueue } from "@/lib/collection/ui.ts";
import { api } from "@/lib/collection/client.ts";
import type { ScanAddResult } from "@/app/collection/[id]/Scanner.tsx";
import PasteList from "@/app/collection/[id]/PasteList.tsx";

// Loaded only when Scan is opened, so the camera code and detector stay out of the page bundle.
const Scanner = dynamic(() => import("@/app/collection/[id]/Scanner.tsx"), { ssr: false });

type FailedLine = { key: number; line: NewLine; grades: { record: Grade; sleeve: Grade } };
let failedKey = 0;

export default function EntryBar({
  sessionId,
  defaultRecord,
  defaultSleeve,
  queryRef,
  items,
  currency,
  onAdded,
}: {
  sessionId: number;
  defaultRecord: Grade;
  defaultSleeve: Grade;
  queryRef: RefObject<HTMLInputElement | null>;
  items: ItemView[];
  currency: string;
  onAdded: () => void;
}) {
  const [query, setQuery] = useState("");
  const [year, setYear] = useState("");
  // Grades are lot-wide defaults that stay put between adds.
  const [record, setRecord] = useState<Grade>(defaultRecord);
  const [sleeve, setSleeve] = useState<Grade>(defaultSleeve);
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Lines that did not save, kept with the grades they were typed under so Retry sends exactly what was entered.
  const [failed, setFailed] = useState<FailedLine[]>([]);
  const [failReason, setFailReason] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const enqueue = useRef(createSerialQueue()).current;
  const [scanning, setScanning] = useState(false);
  // Set when the scanner opened but no barcode detector could load.
  const [scanUnavailable, setScanUnavailable] = useState<string | null>(null);

  // Scans use the same serial queue as typed adds: one line, no year, the grades at scan time.
  function addScanned(code: string): Promise<ScanAddResult> {
    const grades = { record, sleeve };
    return enqueue(async (): Promise<ScanAddResult> => {
      const res = await api<{ added: ItemView[] }>(`/api/sessions/${sessionId}/items`, "POST", { lines: [{ query: code }], ...grades });
      if (!res.ok) return { ok: false, message: res.message };
      onAdded();
      const id = res.data.added[0]?.id;
      return id === undefined ? { ok: false, message: "Not saved." } : { ok: true, id };
    });
  }

  async function post(lines: NewLine[], grades = { record, sleeve }): Promise<string | null> {
    const res = await api(`/api/sessions/${sessionId}/items`, "POST", { lines, ...grades });
    if (!res.ok) return res.message;
    onAdded();
    return null;
  }

  function submit(e: FormEvent) {
    e.preventDefault();
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
    // Snapshot, clear and refocus at once so the next code can be typed while this one saves.
    const line: NewLine = y ? { query: q, year: Number(y) } : { query: q };
    setQuery("");
    setYear("");
    setError(null);
    queryRef.current?.focus();
    save([{ key: ++failedKey, line, grades: { record, sleeve } }]);
  }

  // Each line is posted on its own through the serial queue; a failure keeps the line for Retry, never drops it.
  function save(lines: FailedLine[]) {
    for (const f of lines) {
      setSaving((n) => n + 1);
      void enqueue(() => post([f.line], f.grades)).then((err) => {
        setSaving((n) => n - 1);
        if (!err) return;
        setFailReason(err);
        setFailed((list) => [...list, f]);
      });
    }
  }

  function retryFailed() {
    const lines = failed;
    setFailed([]);
    setFailReason(null);
    save(lines);
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
              aria-describedby={error ? "entry-error" : failed.length > 0 ? "entry-failed" : undefined}
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
            <ScanButton onScan={() => setScanning(true)} unavailable={scanUnavailable} />
            <button type="submit">Add</button>
          </div>
        </div>
        <p className="small muted" role="status">
          {saving > 1 ? `Saving ${saving}…` : ""}
        </p>
        {error && (
          <p className="field-error" id="entry-error" role="alert">
            <span aria-hidden="true">⚠ </span>
            {error}
          </p>
        )}
        {failed.length > 0 && (
          <p className="field-error" id="entry-failed" role="alert" aria-live="assertive">
            <span aria-hidden="true">⚠ </span>
            {failed.length} not saved: {failed.map((f) => f.line.query).join(", ")}
            {failReason ? ` (${failReason})` : ""}{" "}
            <button type="button" className="link" onClick={retryFailed}>
              Retry
            </button>{" "}
            <button
              type="button"
              className="link"
              onClick={() => {
                setFailed([]);
                setFailReason(null);
              }}
            >
              Dismiss
            </button>
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
      {scanning && (
        <Scanner
          grades={{ record, sleeve }}
          items={items}
          currency={currency}
          onCode={addScanned}
          onClose={() => setScanning(false)}
          onUnavailable={() => setScanUnavailable("This browser can't read barcodes. Type the number instead.")}
        />
      )}
    </section>
  );
}
