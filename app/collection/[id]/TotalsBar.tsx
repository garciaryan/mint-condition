"use client";

import { useState } from "react";
import { coverageText, etaText } from "@/lib/collection/ui.ts";
import type { QueueState, Totals } from "@/lib/collection/view.ts";
import DiscogsCredit from "@/app/DiscogsCredit.tsx";
import { money } from "@/lib/collection/client.ts";

export default function TotalsBar({
  totals,
  queue,
  offline,
  currency,
  onResume,
}: {
  totals: Totals;
  queue: QueueState;
  offline: string | null;
  currency: string;
  onResume: () => void;
}) {
  const [open, setOpen] = useState(false);
  const working = queue.pending > 0 && !queue.paused;

  return (
    <section className={`card totals${open ? " open" : ""}`} aria-label="Collection totals">
      {/* Phones only: Suggested and "62/70", tap to expand. Hidden by CSS on wider screens. */}
      <button type="button" className="totals-toggle" aria-expanded={open} aria-controls="totals-detail" onClick={() => setOpen((o) => !o)}>
        <span className="t big">
          <small>Suggested</small>
          <span>{money(totals.suggested, currency)}</span>
        </span>
        <span className="totals-mini">
          <b>
            {totals.priced}/{totals.total} priced
          </b>
          {working && (
            <span>
              <span className="spinner" aria-hidden="true" /> {queue.pending} left
            </span>
          )}
          <span aria-hidden="true">{open ? "▴" : "▾"}</span>
        </span>
      </button>

      <div id="totals-detail" className="totals-detail">
        <div className="t">
          <small>Low</small>
          <span>{money(totals.low, currency)}</span>
        </div>
        <div className="t big">
          <small>Suggested</small>
          <span>{money(totals.suggested, currency)}</span>
        </div>
        <div className="t">
          <small>High</small>
          <span>{money(totals.high, currency)}</span>
        </div>
        <div className="cov">
          <b>{coverageText(totals)}</b>
          {queue.pending > 0 && (
            <span className="queue-line">
              {working && <span className="spinner" aria-hidden="true" />}
              {queue.paused ? `Paused · ${queue.pending} waiting` : `Looking up · ${queue.pending} left · ~${etaText(queue.etaSeconds)}`}
            </span>
          )}
          <DiscogsCredit />
        </div>
      </div>

      <div role="status" className="totals-notes">
        {offline && (
          <p className="totals-offline warn">
            <span aria-hidden="true">⚠ </span>Offline, retrying
            <span className="sr-only">: {offline}</span>
          </p>
        )}
      </div>
      {queue.paused && (
        <p className="totals-paused" role="alert">
          <span aria-hidden="true">⚠ </span>Discogs rejected the token. Fix the token, then press Retry.
          {" "}
          <button type="button" className="link" onClick={onResume}>
            Retry
          </button>
        </p>
      )}
    </section>
  );
}
