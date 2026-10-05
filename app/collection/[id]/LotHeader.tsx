"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { SessionRow } from "../../../lib/collection/types.ts";
import { exportHint } from "../../../lib/collection/export.ts";
import { relativeTime } from "../../../lib/relative-time.ts";
import { api } from "./api.ts";
import { useDialog } from "./useDialog.ts";

export default function LotHeader({
  session,
  oldestPricedAt,
  exportCounts,
  onChanged,
  onDeleted,
  onError,
}: {
  session: SessionRow;
  oldestPricedAt: number | null;
  exportCounts: { exportable: number; lookingUp: number; skipped: number };
  onChanged: () => void;
  onDeleted: () => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState(session.name);
  const [editing, setEditing] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [repricing, setRepricing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const cancelled = useRef(false);
  const deleteTrigger = useRef<HTMLButtonElement>(null);

  // Follow the server name unless the user is mid-edit.
  useEffect(() => {
    if (!editing) setName(session.name);
  }, [session.name, editing]);

  async function save() {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      setName(session.name);
      setNameError(null);
      return;
    }
    const next = name.trim();
    if (next === session.name) return setName(session.name);
    if (!next || next.length > 80) {
      setName(session.name);
      setNameError("Name must be 1 to 80 characters.");
      return;
    }
    setNameError(null);
    const res = await api(`/api/sessions/${session.id}`, "PATCH", { name: next });
    if (res.ok) onChanged();
    else {
      setName(session.name);
      setNameError(res.message);
    }
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") e.currentTarget.blur();
    else if (e.key === "Escape") {
      cancelled.current = true;
      e.currentTarget.blur();
    }
  }

  async function reprice() {
    setRepricing(true);
    const res = await api(`/api/sessions/${session.id}/reprice`, "POST", {});
    setRepricing(false);
    if (res.ok) onChanged();
    else onError(`Could not re-price: ${res.message}`);
  }

  const created = new Date(session.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <header className="lot-head">
      <h1 className="lot-title">
        <label htmlFor="lot-name-edit" className="sr-only">
          Lot name
        </label>
        <input
          id="lot-name-edit"
          value={name}
          maxLength={80}
          autoComplete="off"
          onFocus={() => setEditing(true)}
          onChange={(e) => setName(e.target.value)}
          onBlur={save}
          onKeyDown={onKey}
          aria-describedby={nameError ? "lot-name-error" : "lot-name-hint"}
          aria-invalid={nameError ? true : undefined}
        />
        <span id="lot-name-hint" className="sr-only">
          Press Enter to save the name, Escape to cancel.
        </span>
      </h1>
      <p className="meta muted small">
        Lot · {created} · defaults {session.defaultRecord} / {session.defaultSleeve}
      </p>
      <div className="lot-actions">
        <button type="button" className="secondary quiet" onClick={reprice} disabled={repricing}>
          {repricing ? "Re-pricing…" : "Re-price all"}
        </button>
        {oldestPricedAt !== null && Date.now() - oldestPricedAt > 3_600_000 && (
          <span className="meta muted small price-age">Oldest prices: {relativeTime(oldestPricedAt)}</span>
        )}
        {exportCounts.exportable > 0 ? (
          <a className="action-link" href={`/api/sessions/${session.id}/discogs.csv`} aria-describedby="lot-export-hint">
            Export for Discogs
          </a>
        ) : (
          <span className="action-link" aria-disabled="true" aria-describedby="lot-export-hint">
            Export for Discogs
          </span>
        )}
        <a className="action-link" href={`/collection/${session.id}/print`}>
          Print buy sheet
        </a>
        <button type="button" className="secondary danger" ref={deleteTrigger} onClick={() => setConfirming(true)}>
          Delete lot
        </button>
      </div>
      <p className="meta muted small export-hint" id="lot-export-hint">
        {exportHint(exportCounts)}
      </p>
      {nameError && (
        <p className="field-error lot-name-error" id="lot-name-error" role="alert">
          <span aria-hidden="true">⚠ </span>
          {nameError}
        </p>
      )}
      {confirming && (
        <ConfirmDelete
          session={session}
          trigger={deleteTrigger.current}
          onCancel={() => setConfirming(false)}
          onDeleted={onDeleted}
        />
      )}
    </header>
  );
}

function ConfirmDelete({
  session,
  trigger,
  onCancel,
  onDeleted,
}: {
  session: SessionRow;
  trigger: HTMLElement | null;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDialog(ref, onCancel, { returnTo: trigger, initialFocus: () => cancelRef.current });

  async function confirm() {
    setBusy(true);
    setError(null);
    const res = await api(`/api/sessions/${session.id}`, "DELETE");
    if (res.ok || res.status === 404) return onDeleted();
    setBusy(false);
    setError(res.message);
  }

  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby="del-heading" aria-describedby="del-desc" tabIndex={-1}>
        <h2 id="del-heading">Delete this lot?</h2>
        <p id="del-desc">
          “{session.name}” and all of its records will be removed. This cannot be undone.
        </p>
        {error && (
          <p className="field-error" role="alert">
            <span aria-hidden="true">⚠ </span>
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="secondary" ref={cancelRef} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="danger-solid" onClick={confirm} disabled={busy}>
            {busy ? "Deleting…" : "Delete lot"}
          </button>
        </div>
      </div>
    </div>
  );
}
