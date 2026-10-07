"use client";

import { useEffect, useRef, useState } from "react";
import type { Candidate } from "@/lib/types.ts";
import type { ItemView } from "@/lib/collection/view.ts";
import Picker from "@/app/Picker.tsx";
import { api } from "@/lib/collection/client.ts";
import { useDialog } from "@/hooks/useDialog.ts";

export default function PickPanel({
  item,
  trigger,
  onClose,
  onPicked,
}: {
  item: ItemView;
  trigger: HTMLElement | null;
  onClose: () => void;
  /** Called after a successful PATCH; the parent closes the panel and moves focus. */
  onPicked: (item: ItemView) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useDialog(ref, onClose, { returnTo: trigger, initialFocus: () => headingRef.current });

  useEffect(() => {
    const ctrl = new AbortController();
    setLoadError(null);
    (async () => {
      const res = await api<{ candidates: Candidate[] }>(`/api/items/${item.id}/candidates`, "GET", undefined, ctrl.signal);
      if (ctrl.signal.aborted) return;
      if (res.ok) setCandidates(res.data.candidates);
      else setLoadError(res.message);
    })();
    return () => ctrl.abort();
  }, [item.id, attempt]);

  async function pick(c: Candidate) {
    if (saving) return;
    setSaving(true);
    setPickError(null);
    const res = await api(`/api/items/${item.id}`, "PATCH", { releaseId: c.id });
    setSaving(false);
    if (res.ok) onPicked(item);
    else setPickError(res.message);
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="panel" role="dialog" aria-modal="true" aria-labelledby="pick-heading" tabIndex={-1}>
        <div className="panel-head">
          <div className="grab" aria-hidden="true" />
          <h2 id="pick-heading" ref={headingRef} tabIndex={-1}>
            Pick a pressing for {item.query}
          </h2>
          <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div className="panel-body" aria-busy={saving}>
          {pickError && (
            <p className="field-error" role="alert">
              <span aria-hidden="true">⚠ </span>
              {pickError}
            </p>
          )}
          {loadError ? (
            <div className="card error" role="alert">
              <p>{loadError}</p>
              <button type="button" className="secondary" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            </div>
          ) : candidates === null ? (
            <div className="muted loading" role="status">
              <span className="spinner" aria-hidden="true" />
              <span>Loading pressings…</span>
            </div>
          ) : (
            <Picker candidates={candidates} query={item.query} year={item.year ?? undefined} onPick={pick} />
          )}
        </div>
      </div>
    </div>
  );
}
