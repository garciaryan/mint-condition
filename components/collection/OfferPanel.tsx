"use client";

import { useEffect, useRef, useState } from "react";
import type { SessionRow } from "@/lib/collection/types.ts";
import { cash, offerNotes, offerSummary } from "@/lib/collection/ui.ts";
import type { OfferSide, OfferView } from "@/lib/offer.ts";
import DiscogsCredit from "@/components/ui/DiscogsCredit.tsx";
import { api } from "@/lib/collection/client.ts";

const OPEN_KEY = "offerPanelOpen";

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

type AmountKey = "pickThreshold" | "bulkEach" | "lotOverhead";

/**
 * A $ field that saves on blur or Enter. It keeps its own draft while focused or after a failed save, so a poll
 * landing mid-edit never resets what the owner is typing.
 */
function AmountField({
  id,
  label,
  value,
  placeholder,
  nullable,
  onSave,
}: {
  id: string;
  label: string;
  value: number | null;
  placeholder?: string;
  nullable: boolean;
  onSave: (v: number | null) => Promise<string | null>;
}) {
  const shown = value === null ? "" : String(value);
  const [draft, setDraft] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current && !error) setDraft(shown);
  }, [shown, error]);

  async function commit() {
    const text = draft.trim();
    const v = text === "" ? (nullable ? null : 0) : Number(text);
    if (v !== null && (!Number.isFinite(v) || v < 0)) {
      setError("Enter an amount of 0 or more.");
      return;
    }
    if (v === value) {
      setError(null);
      setDraft(shown);
      return;
    }
    const message = await onSave(v);
    setError(message);
  }

  const errId = `${id}-err`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={draft}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        onFocus={() => (focused.current = true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          focused.current = false;
          void commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          }
        }}
      />
      {error && (
        <p id={errId} className="field-error small">
          {error}
        </p>
      )}
    </div>
  );
}

function Ladder({ caption, side, opening, currency }: { caption: string; side: OfferSide; opening: number; currency: string }) {
  return (
    <div className="offer-side">
      <table className="ladder">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Percent</th>
            <th scope="col">Offer</th>
            <th scope="col">You keep</th>
          </tr>
        </thead>
        <tbody>
          {side.rungs.map((r) => (
            <tr key={r.percent} className={r.percent === opening ? "opening" : undefined}>
              <th scope="row">
                {r.percent}%{r.percent === opening && <span className="tag">Opening</span>}
              </th>
              <td>
                {r.overMax ? (
                  <>
                    <s>{cash(r.amount, currency)}</s> <span className="over">over max</span>
                  </>
                ) : (
                  cash(r.amount, currency)
                )}
              </td>
              <td>{cash(r.keep, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="walk-away">
        Walk-away <b>{cash(side.walkAway, currency)}</b>
      </p>
    </div>
  );
}

export default function OfferPanel({
  offer,
  session,
  currency,
  onChanged,
}: {
  offer: OfferView;
  session: SessionRow;
  currency: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [unverified, setUnverified] = useState(session.unverified);
  useEffect(() => setOpen(readOpen()), []);
  useEffect(() => setUnverified(session.unverified), [session.unverified]);
  const [skipSlow, setSkipSlow] = useState(session.skipSlow);
  useEffect(() => setSkipSlow(session.skipSlow), [session.skipSlow]);

  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      // Private mode or blocked storage: the panel still works, it just won't remember.
    }
  }

  async function save(
    patch: Partial<Record<AmountKey, number | null>> | { unverified: boolean } | { skipSlow: boolean },
  ): Promise<string | null> {
    const res = await api(`/api/sessions/${session.id}`, "PATCH", patch);
    onChanged();
    return res.ok ? null : res.message;
  }

  async function changeUnverified(v: boolean) {
    setUnverified(v);
    if (await save({ unverified: v })) setUnverified(!v);
  }

  async function changeSkipSlow(v: boolean) {
    setSkipSlow(v);
    if (await save({ skipSlow: v })) setSkipSlow(!v);
  }

  const i = offer.inputs;
  const notes = offerNotes(offer, currency);
  const records = (n: number) => `${n} ${n === 1 ? "record" : "records"}`;

  return (
    <section className={`card offer${open ? " open" : ""}`} aria-label="Offer">
      <button type="button" className="offer-toggle" aria-expanded={open} aria-controls="offer-detail" onClick={toggle}>
        <span>{offerSummary(offer, currency)}</span>
        <span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div id="offer-detail" className="offer-detail">
          <div className="offer-inputs">
            <label className="field inline switch">
              <input type="checkbox" checked={unverified} onChange={(e) => void changeUnverified(e.target.checked)} />
              Condition unverified
            </label>
            <label className="field inline switch">
              <input type="checkbox" checked={skipSlow} onChange={(e) => void changeSkipSlow(e.target.checked)} />
              Leave slow sellers out of picks
            </label>
            <AmountField
              id="offer-threshold"
              label="Pick threshold $"
              value={session.pickThreshold}
              placeholder={String(i.pickThreshold)}
              nullable
              onSave={(v) => save({ pickThreshold: v })}
            />
            <AmountField
              id="offer-bulk"
              label="Bulk per record $"
              value={session.bulkEach}
              placeholder={String(i.bulkEach)}
              nullable
              onSave={(v) => save({ bulkEach: v })}
            />
            <AmountField
              id="offer-overhead"
              label="Collection overhead $"
              value={session.lotOverhead}
              nullable={false}
              onSave={(v) => save({ lotOverhead: v })}
            />
          </div>
          <div className="offer-sides">
            <Ladder caption={`Cherry-picks (${records(offer.picks)})`} side={offer.pickOnly} opening={offer.openingPercent} currency={currency} />
            <Ladder
              caption={`Whole collection (${records(offer.picks + offer.bulkCount)})`}
              side={offer.wholeLot}
              opening={offer.openingPercent}
              currency={currency}
            />
          </div>
          {notes.length > 0 && (
            <ul className="offer-notes small" aria-live="polite">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <p className="small muted">
            Walk-away keeps a {i.marginPercent}% margin after Discogs fees and {cash(i.overheadPerRecord, currency, true)}/record
            overhead. Change these in Settings.
          </p>
          <p className="small muted">Discogs figures are asking prices and suggestions, not sales.</p>
          <DiscogsCredit />
        </div>
      )}
    </section>
  );
}
