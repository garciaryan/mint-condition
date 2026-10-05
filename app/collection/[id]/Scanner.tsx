"use client";

import { useEffect, useRef, useState } from "react";
import type { Grade } from "../../../lib/types.ts";
import { STATUS_INFO, createScanFilter } from "../../../lib/collection/ui.ts";
import type { ItemView } from "../../../lib/collection/view.ts";
import { money } from "./api.ts";
import { Icon } from "./ItemRow.tsx";
import { useDialog } from "./useDialog.ts";

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

type Detector = { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> };
type DetectorCtor = {
  new (opts: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
};

/** Add result for one scanned code: the created item's id, or the error to show. */
export type ScanAddResult = { ok: true; id: number } | { ok: false; message: string };
export type ScanAdd = (code: string) => Promise<ScanAddResult>;

type Entry = { key: number; code: string; itemId?: number; error?: string };

async function loadDetector(): Promise<Detector> {
  const native = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (native) {
    try {
      if ((await native.getSupportedFormats()).includes("ean_13")) return new native({ formats: FORMATS });
    } catch {}
  }
  const { BarcodeDetector } = await import("barcode-detector/ponyfill");
  return new (BarcodeDetector as unknown as DetectorCtor)({ formats: FORMATS });
}

export default function Scanner({
  grades,
  items,
  onCode,
  onClose,
  onUnavailable,
}: {
  grades: { record: Grade; sleeve: Grade };
  items: ItemView[];
  onCode: ScanAdd;
  onClose: () => void;
  onUnavailable: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [last, setLast] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;
  const stopRef = useRef<() => void>(() => {});

  function close() {
    stopRef.current();
    onCloseRef.current();
  }
  useDialog(rootRef, close, { initialFocus: () => rootRef.current?.querySelector<HTMLElement>("button") });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stream: MediaStream | null = null;
    const accept = createScanFilter();
    let nextId = 1;

    function stop() {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    }
    stopRef.current = stop;

    function handle(code: string) {
      const id = nextId++;
      navigator.vibrate?.(60);
      setLast(code);
      setEntries((list) => [{ key: id, code }, ...list]);
      void onCodeRef.current(code).then((res) => {
        setEntries((list) =>
          list.map((e) => (e.key === id ? (res.ok ? { ...e, itemId: res.id } : { ...e, error: res.message }) : e)),
        );
      });
    }

    async function run() {
      let detector: Detector;
      try {
        detector = await loadDetector();
      } catch {
        if (!cancelled) {
          onUnavailableRef.current();
          onCloseRef.current();
        }
        return;
      }
      if (cancelled) return;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof DOMException && e.name === "NotAllowedError") setBlocked(true);
        else setProblem("Couldn't start the camera. Close this and type the number instead.");
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      try {
        await video.play();
      } catch {}
      setReady(true);

      let failures = 0;
      async function tick() {
        if (cancelled) return;
        try {
          if (video && video.readyState >= 2) {
            const found = await detector.detect(video);
            failures = 0;
            if (!cancelled && found.length > 0) {
              const code = found[0].rawValue;
              if (accept(code, Date.now())) handle(code);
            }
          }
        } catch {
          // Skip a bad frame, but give up if detection keeps failing (e.g. the WASM never loaded).
          if (++failures >= 8 && !cancelled) {
            stop();
            setProblem("The scanner couldn't start (check your connection). Type the number instead.");
            return;
          }
        }
        if (!cancelled) timer = setTimeout(tick, 250);
      }
      void tick();
    }
    void run();
    return stop;
  }, []);

  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-label="Scan barcodes" ref={rootRef} tabIndex={-1}>
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
          <div className="scanner-frame" aria-hidden="true" />
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
              <EntryStatus entry={e} items={items} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function EntryStatus({ entry, items }: { entry: Entry; items: ItemView[] }) {
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
  const st = STATUS_INFO[item?.status ?? "pending"];
  return (
    <span>
      {st.icon === "spinner" ? <span aria-hidden="true">… </span> : <Icon name={st.icon} />} {st.text}
      {item?.market ? ` · ${money(item.market.suggested)}` : ""}
    </span>
  );
}
