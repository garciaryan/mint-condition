"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import type { SessionRow } from "@/lib/collection/types.ts";
import { exportHint } from "@/lib/collection/export.ts";
import { relativeTime } from "@/lib/relative-time.ts";
import { useDisclosure } from "@/hooks/useDisclosure.ts";
import { api } from "@/app/collection/[id]/api.ts";
import { useDialog } from "@/hooks/useDialog.ts";
import { ROUTES } from "@/lib/consts.ts";

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
  const menu = useDisclosure();
  const router = useRouter();

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
    if (res.ok) {
      onChanged();
      router.refresh(); // the sidebar lists collections by name
    }
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
          Collection name
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
        Collection · {created} · defaults {session.defaultRecord} / {session.defaultSleeve}
      </p>
      <div className="lot-actions">
        <div ref={menu.root} className="dropdown">
          <button
            ref={menu.button}
            type="button"
            className="secondary"
            aria-expanded={menu.open}
            aria-controls="lot-actions-menu"
            onClick={menu.toggle}
          >
            {repricing ? "Re-pricing…" : "Actions"}
            <span aria-hidden="true"> ▾</span>
          </button>
          {menu.open && (
            <ul id="lot-actions-menu" className="dropdown-panel">
              <li>
                <button
                  type="button"
                  className="dropdown-item"
                  disabled={repricing}
                  onClick={() => {
                    menu.close();
                    void reprice();
                  }}
                >
                  Re-price all
                </button>
              </li>
              <li>
                {exportCounts.exportable > 0 ? (
                  <a className="dropdown-item" href={`/api/sessions/${session.id}/discogs.csv`} aria-describedby="lot-export-hint">
                    Export for Discogs
                  </a>
                ) : (
                  <span className="dropdown-item" role="link" aria-disabled="true" tabIndex={0} aria-describedby="lot-export-hint">
                    Export for Discogs
                  </span>
                )}
                <p className="dropdown-hint muted small" id="lot-export-hint">
                  {exportHint(exportCounts)}
                </p>
              </li>
              <li>
                <a className="dropdown-item" href={ROUTES.print(session.id)}>
                  Print buy sheet
                </a>
              </li>
              <li className="dropdown-sep">
                <button
                  type="button"
                  className="dropdown-item danger"
                  onClick={() => {
                    menu.close();
                    setConfirming(true);
                  }}
                >
                  Delete collection
                </button>
              </li>
            </ul>
          )}
        </div>
        {oldestPricedAt !== null && Date.now() - oldestPricedAt > 3_600_000 && (
          <span className="meta muted small price-age">Oldest prices: {relativeTime(oldestPricedAt)}</span>
        )}
      </div>
      {nameError && (
        <p className="field-error lot-name-error" id="lot-name-error" role="alert">
          <span aria-hidden="true">⚠ </span>
          {nameError}
        </p>
      )}
      {confirming && (
        <ConfirmDelete
          session={session}
          trigger={menu.button.current}
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
        <h2 id="del-heading">Delete this collection?</h2>
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
            {busy ? "Deleting…" : "Delete collection"}
          </button>
        </div>
      </div>
    </div>
  );
}
