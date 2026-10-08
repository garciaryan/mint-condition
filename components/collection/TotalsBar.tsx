"use client";

import { useState } from "react";
import { coverageText, pausedText, queueLine, type DiscogsMode } from "@/lib/collection/ui.ts";
import type { QueueState, Totals } from "@/lib/collection/view.ts";
import DiscogsCredit from "@/components/ui/DiscogsCredit.tsx";
import { money } from "@/lib/collection/client.ts";

export default function TotalsBar({
  totals,
  queue,
  offline,
  currency,
  onResume,
  discogs,
}: {
  totals: Totals;
  queue: QueueState;
  offline: string | null;
  currency: string;
  onResume: () => void;
  discogs: DiscogsMode;
}) {
  const [open, setOpen] = useState(false);
  const line = queueLine(queue, discogs);
  const working = line?.spinner ?? false;

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
          {line && (
            <span className="queue-line">
              {line.spinner && <span className="spinner" aria-hidden="true" />}
              {line.text}
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
          <span aria-hidden="true">⚠ </span>{pausedText(discogs)}
          {" "}
          <button type="button" className="link" onClick={onResume}>
            Retry
          </button>
        </p>
      )}
    </section>
  );
}
