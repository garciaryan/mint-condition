"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { ItemView } from "@/lib/collection/view.ts";
import { DATA_CREDIT, releaseUrl } from "@/lib/discogs-terms.ts";
import type { Grade } from "@/lib/types.ts";
import DemandBadge from "@/components/ui/DemandBadge.tsx";
import GradeSelect from "@/components/ui/GradeSelect.tsx";
import { Thumb } from "@/components/lookup/Picker.tsx";
import { addTag, cleanNote, hasTag, NOTE_MAX, NOTE_TAGS, noteKeyAction } from "@/lib/collection/notes.ts";
import { STATUS_INFO, displayStatus } from "@/lib/collection/ui.ts";
import { money } from "@/lib/collection/client.ts";

export const ICONS = {
  check: "M20 6 9 17l-5-5",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  dash: "M5 12h14",
  warn: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  x: "M18 6 6 18M6 6l12 12",
  clock: "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
  pencil: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9L12 3Z",
} as const;

export function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

const STATUS = STATUS_INFO;

function subline(item: ItemView): string {
  if (item.release) {
    const r = item.release;
    const base = [r.label, r.catno, r.country, r.year, r.format].filter(Boolean);
    if (item.status === "error" && item.error) {
      base.push(item.market ? `Re-price failed: ${item.error} · showing earlier price` : item.error);
    }
    return base.join(" · ");
  }
  const bits: string[] = [item.year ? String(item.year) : "No year"];
  if (item.status === "to-pick") bits.push(`${item.candidateCount} pressings match`);
  else if (item.status === "pending") bits.push("just added");
  else if (item.status === "no-match") bits.push("no pressing found");
  else if (item.status === "error" && item.error) bits.push(item.error);
  return bits.join(" · ");
}

function marketCell(item: ItemView, currency: string): ReactNode {
  if (item.market) {
    return (
      <>
        <b>{money(item.market.suggested, currency)}</b>
        <span className="sub">
          {money(item.market.low, currency)} – {money(item.market.high, currency)}
        </span>
      </>
    );
  }
  return <span className="sub">{marketNote(item)}</span>;
}

/** Why a row has no market value yet. */
function marketNote(item: ItemView): string {
  return item.status === "to-pick" ? "not counted yet"
    : item.status === "no-price" || item.status === "priced" ? "no Discogs suggestions"
    : item.status === "error" || item.status === "no-match" ? "not counted"
    : "—";
}

/** Phones: the market value labelled like the single-record result card. Hidden on wider screens. */
function marketBlock(item: ItemView, currency: string): ReactNode {
  return (
    <div className="price-block row-market">
      <div className="row-market-title">Market value</div>
      {item.market ? (
        <div className="range">
          <span>
            <small>Low</small>
            {money(item.market.low, currency)}
          </span>
          <span className="big">
            <small>Suggested</small>
            {money(item.market.suggested, currency)}
          </span>
          <span>
            <small>High</small>
            {money(item.market.high, currency)}
          </span>
        </div>
      ) : (
        <p className="muted small">{marketNote(item)}</p>
      )}
    </div>
  );
}

export default function ItemRow({
  item,
  currency,
  onGrade,
  onStar,
  onPick,
  onRetry,
  onRemove,
  onNote,
}: {
  item: ItemView;
  currency: string;
  onGrade: (id: number, patch: { record?: Grade; sleeve?: Grade }) => Promise<boolean>;
  onStar: (id: number, pick: boolean) => void;
  onPick: (item: ItemView, trigger: HTMLButtonElement) => void;
  onRetry: (id: number) => void;
  onRemove: (item: ItemView) => void;
  onNote: (id: number, notes: string) => Promise<{ ok: true } | { ok: false; message: string }>;
}) {
  // Shown immediately on change; snaps back if the save fails.
  const [record, setRecord] = useState(item.record);
  const [sleeve, setSleeve] = useState(item.sleeve);
  const [saving, setSaving] = useState(false);
  useEffect(() => setRecord(item.record), [item.record]);
  useEffect(() => setSleeve(item.sleeve), [item.sleeve]);

  async function change(which: "record" | "sleeve", g: Grade) {
    (which === "record" ? setRecord : setSleeve)(g);
    setSaving(true);
    const ok = await onGrade(item.id, { [which]: g });
    setSaving(false);
    if (!ok) (which === "record" ? setRecord : setSleeve)(item[which]);
  }

  // Note editor. The draft is the row's own state, so a poll refresh never resets it.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const noteButton = useRef<HTMLButtonElement>(null);
  const noteField = useRef<HTMLTextAreaElement>(null);
  const focusButton = useRef(false);
  // Bumped on every open and close, so a save that answers after Cancel never closes a newer editor.
  const noteSession = useRef(0);
  const noteId = useId();
  useEffect(() => {
    if (editing) noteField.current?.focus();
    else if (focusButton.current) {
      focusButton.current = false;
      noteButton.current?.focus();
    }
  }, [editing]);

  function openNote() {
    noteSession.current++;
    setNoteSaving(false);
    setDraft(item.notes);
    setNoteError(null);
    setEditing(true);
  }

  function closeNote() {
    noteSession.current++;
    focusButton.current = true;
    setEditing(false);
  }

  // The limit applies to the cleaned note (what is stored), not the raw text with its extra spaces.
  const noteLength = cleanNote(draft).length;
  const noteOver = noteLength > NOTE_MAX;

  async function saveNote() {
    if (noteSaving || noteOver) return;
    const session = noteSession.current;
    setNoteSaving(true);
    setNoteError(null);
    const res = await onNote(item.id, draft);
    if (session !== noteSession.current) return;
    setNoteSaving(false);
    if (res.ok) closeNote();
    else setNoteError(res.message);
  }

  function noteKey(e: KeyboardEvent) {
    const action = noteKeyAction({
      key: e.key,
      isComposing: e.nativeEvent.isComposing,
      keyCode: e.keyCode,
      inField: e.target === noteField.current,
    });
    if (!action) return;
    e.preventDefault();
    if (action === "cancel") closeNote();
    else void saveNote();
  }

  const st = STATUS[displayStatus(item)];
  const busy = item.status === "pending" || item.status === "looking-up";
  const dim = (busy && item.market !== null) || saving;
  const title = item.release?.title ?? item.query;

  return (
    <li className={`row${item.status === "pending" ? " new" : ""}`} data-item={item.id}>
      <div className="row-thumb">
        <Thumb src={item.release?.thumb ?? null} />
      </div>
      <div className="row-main">
        <div className="title">{title}</div>
        <div className="row-meta">
          <div className="sub">{subline(item)}</div>
          {item.demand && (item.demand === "fast" || item.demand === "slow") && (
            <div className="sub">
              <DemandBadge demand={item.demand} have={item.have} want={item.want} forSale={item.stats?.numForSale ?? 0} />
            </div>
          )}
          {item.release && (
            <div className="sub">
              <a href={releaseUrl(item.release.id)} target="_blank" rel="noreferrer">
                {DATA_CREDIT}<span aria-hidden="true"> ↗</span>
                <span className="sr-only"> for {title} (opens in a new tab)</span>
              </a>
            </div>
          )}
          {item.notes && <div className="sub row-note">{item.notes}</div>}
        </div>
      </div>
      <div className="row-grades">
        <span className="grade">
          <small aria-hidden="true">Rec</small>
          <GradeSelect id={`rec-${item.id}`} value={record} onChange={(g) => change("record", g)} label={`Record grade for ${title}`} />
        </span>
        <span className="grade">
          <small aria-hidden="true">Slv</small>
          <GradeSelect id={`slv-${item.id}`} value={sleeve} onChange={(g) => change("sleeve", g)} label={`Sleeve grade for ${title}`} />
        </span>
      </div>
      <div className={`row-price${dim ? " dim" : ""}`}>
        {item.canPick && (
          <button
            type="button"
            className={`star${item.isPick ? " on" : ""}`}
            aria-pressed={item.isPick}
            aria-label={`Cherry-pick ${title}`}
            title="Cherry-pick"
            onClick={() => onStar(item.id, !item.isPick)}
          >
            <Icon name="star" />
          </button>
        )}
        <div className="row-value">{marketCell(item, currency)}</div>
        {marketBlock(item, currency)}
      </div>
      <div className="row-foot">
        <div className="row-status">
          <span className={`status ${st.cls}`}>
            {st.icon === "spinner" ? <span className="spinner" aria-hidden="true" /> : <Icon name={st.icon} />}
            {st.text}
          </span>
        </div>
        <div className="row-actions">
          {item.status === "to-pick" && (
            <button type="button" className="row-action" data-pick-for={item.id} onClick={(e) => onPick(item, e.currentTarget)}>
              Pick pressing<span className="sr-only"> for {title}</span>
            </button>
          )}
          {(item.status === "error" || item.status === "no-match") && (
            <button type="button" className="row-action" onClick={() => onRetry(item.id)}>
              Retry<span className="sr-only"> {title}</span>
            </button>
          )}
          <button
            type="button"
            className={`row-action note-btn${item.notes ? " has-note" : ""}`}
            ref={noteButton}
            aria-expanded={editing}
            aria-controls={editing ? `${noteId}-editor` : undefined}
            onClick={() => (editing ? closeNote() : openNote())}
          >
            <Icon name="pencil" />
            <span className="note-label">
              {item.notes ? "Edit note" : "Note"}
              <span className="sr-only"> for {title}</span>
            </span>
          </button>
          <button type="button" className="row-action danger" onClick={() => onRemove(item)}>
            Remove<span className="sr-only"> {title}</span>
          </button>
        </div>
      </div>
      {editing && (
        <form
          className="note-editor"
          id={`${noteId}-editor`}
          onKeyDown={noteKey}
          onSubmit={(e) => {
            e.preventDefault();
            void saveNote();
          }}
        >
          <label className="sr-only" htmlFor={`${noteId}-text`}>
            Note for {title}
          </label>
          <textarea
            id={`${noteId}-text`}
            ref={noteField}
            rows={2}
            maxLength={NOTE_MAX * 4}
            readOnly={noteSaving}
            value={draft}
            placeholder="Condition notes for the listing"
            aria-describedby={`${noteId}-count${noteError ? ` ${noteId}-error` : ""}`}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="note-tags">
            {NOTE_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                className="note-chip"
                disabled={noteSaving || hasTag(draft, tag) || addTag(draft, tag) === null}
                onClick={() => {
                  const next = addTag(draft, tag);
                  if (next !== null) setDraft(next);
                  noteField.current?.focus();
                }}
              >
                + {tag}
              </button>
            ))}
          </div>
          {noteError && (
            <p className="field-error" role="alert" id={`${noteId}-error`}>
              {noteError}
            </p>
          )}
          <div className="note-foot">
            <span className={`note-count${noteOver ? " over" : ""}`} id={`${noteId}-count`}>
              {noteLength}/{NOTE_MAX}
              {noteOver && <span className="sr-only"> (too long)</span>}
            </span>
            <button type="button" className="secondary" onClick={closeNote}>
              Cancel
            </button>
            <button type="submit" disabled={noteSaving || noteOver} aria-busy={noteSaving}>
              {noteSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
