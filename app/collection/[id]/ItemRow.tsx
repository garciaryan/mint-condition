"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { ItemView } from "../../../lib/collection/view.ts";
import type { Grade } from "../../../lib/types.ts";
import GradeSelect from "../../GradeSelect.tsx";
import { Thumb } from "../../Picker.tsx";
import { STATUS_INFO, displayStatus } from "../../../lib/collection/ui.ts";
import { money } from "./api.ts";

export const ICONS = {
  check: "M20 6 9 17l-5-5",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  dash: "M5 12h14",
  warn: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  x: "M18 6 6 18M6 6l12 12",
  clock: "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z",
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
  const note =
    item.status === "to-pick" ? "not counted yet"
    : item.status === "no-price" || item.status === "priced" ? "no Discogs suggestions"
    : item.status === "error" || item.status === "no-match" ? "not counted"
    : "—";
  return <span className="sub">{note}</span>;
}

export default function ItemRow({
  item,
  currency,
  onGrade,
  onPick,
  onRetry,
  onRemove,
}: {
  item: ItemView;
  currency: string;
  onGrade: (id: number, patch: { record?: Grade; sleeve?: Grade }) => Promise<boolean>;
  onPick: (item: ItemView, trigger: HTMLButtonElement) => void;
  onRetry: (id: number) => void;
  onRemove: (item: ItemView) => void;
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
        <div className="sub">{subline(item)}</div>
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
      <div className={`row-price${dim ? " dim" : ""}`}>{marketCell(item, currency)}</div>
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
        <button type="button" className="row-action danger" onClick={() => onRemove(item)}>
          Remove<span className="sr-only"> {title}</span>
        </button>
      </div>
    </li>
  );
}
