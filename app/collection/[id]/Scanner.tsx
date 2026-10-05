"use client";

import { useRef, useState } from "react";
import type { Grade } from "../../../lib/types.ts";
import { STATUS_INFO, displayStatus } from "../../../lib/collection/ui.ts";
import type { ItemView } from "../../../lib/collection/view.ts";
import { money } from "./api.ts";
import { Icon } from "./ItemRow.tsx";
import { LOT_CUE_MS } from "../../../lib/camera.ts";
import ScanFrame from "../../ScanFrame.tsx";
import { useBarcodeCamera } from "../../useBarcodeCamera.ts";
import { useFadeOut } from "../../useFadeOut.ts";
import { useDialog } from "./useDialog.ts";

/** Add result for one scanned code: the created item's id, or the error to show. */
export type ScanAddResult = { ok: true; id: number } | { ok: false; message: string };
export type ScanAdd = (code: string) => Promise<ScanAddResult>;

type Entry = { key: number; code: string; itemId?: number; error?: string };

export default function Scanner({
  grades,
  items,
  currency,
  onCode,
  onClose,
  onUnavailable,
}: {
  grades: { record: Grade; sleeve: Grade };
  items: ItemView[];
  currency: string;
  onCode: ScanAdd;
  onClose: () => void;
  onUnavailable: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [last, setLast] = useState("");
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const nextId = useRef(1);

  function handle(code: string) {
    const id = nextId.current++;
    setLast(code);
    setEntries((list) => [{ key: id, code }, ...list]);
    void onCodeRef.current(code).then((res) => {
      setEntries((list) =>
        list.map((e) => (e.key === id ? (res.ok ? { ...e, itemId: res.id } : { ...e, error: res.message }) : e)),
      );
    });
  }

  const fade = useFadeOut(() => onCloseRef.current());
  const camera = useBarcodeCamera(videoRef, handle, () => {
    onUnavailable();
    onCloseRef.current();
  });
  const blocked = camera.state.kind === "blocked";
  const problem = camera.state.kind === "problem" ? camera.state.message : null;
  const ready = camera.state.kind === "ready";

  function close() {
    camera.stop();
    fade.start();
  }
  useDialog(rootRef, close, { initialFocus: () => rootRef.current?.querySelector<HTMLElement>("button") });

  return (
    <div
      className={fade.closing ? "scanner closing" : "scanner"}
      role="dialog"
      aria-modal="true"
      aria-label="Scan barcodes"
      ref={rootRef}
      tabIndex={-1}
    >
      <header className="scanner-head">
        <strong>
          Scanning · {grades.record} / {grades.sleeve}
        </strong>
        <button type="button" onClick={close}>
          Done
        </button>
      </header>
      {blocked ? (
        <div className="scanner-msg" role="alert">
          <p>
            Camera blocked. Allow camera access for this site in your browser settings, or type the number instead.
          </p>
          <button type="button" onClick={close}>
            Close
          </button>
        </div>
      ) : problem ? (
        <div className="scanner-msg" role="alert">
          <p>{problem}</p>
          <button type="button" onClick={close}>
            Close
          </button>
        </div>
      ) : (
        <div className="scanner-view">
          <video ref={videoRef} playsInline muted autoPlay />
          {!ready && <p className="scanner-wait">Starting camera…</p>}
          <ScanFrame last={camera.lastScan} holdMs={LOT_CUE_MS} />
        </div>
      )}
      <p className="scanner-toast" role="status" aria-live="polite">
        {last ? `Added ${last} · keep scanning` : "Point the camera at a barcode."}
      </p>
      <section className="scanner-list" aria-label="This session">
        <h2>This session ({entries.length})</h2>
        <ul>
          {entries.map((e) => (
            <li key={e.key}>
              <code>{e.code}</code>
              <EntryStatus entry={e} items={items} currency={currency} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function EntryStatus({ entry, items, currency }: { entry: Entry; items: ItemView[]; currency: string }) {
  if (entry.error) {
    return (
      <span>
        <Icon name="warn" /> {entry.error}
      </span>
    );
  }
  if (entry.itemId === undefined) return <span>… Adding…</span>;
  const item = items.find((i) => i.id === entry.itemId);
  // Not in the polled list yet: it was just saved, so it is queued.
  const st = STATUS_INFO[item ? displayStatus(item) : "pending"];
  return (
    <span>
      {st.icon === "spinner" ? <span aria-hidden="true">… </span> : <Icon name={st.icon} />} {st.text}
      {item?.market ? ` · ${money(item.market.suggested, currency)}` : ""}
    </span>
  );
}
