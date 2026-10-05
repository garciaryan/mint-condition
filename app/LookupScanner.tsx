"use client";

import { useEffect, useRef, useState } from "react";
import { LOOKUP_HOLD_MS } from "../lib/camera.ts";
import ScanFrame from "./ScanFrame.tsx";
import { useFadeOut } from "./useFadeOut.ts";
import { useDialog } from "./collection/[id]/useDialog.ts";
import { useBarcodeCamera } from "./useBarcodeCamera.ts";

// One-shot scanner for the single-record page: the first barcode read closes the camera and is handed back.
export default function LookupScanner({
  onCode,
  onClose,
  onUnavailable,
}: {
  onCode: (code: string) => void;
  onClose: () => void;
  onUnavailable: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const done = useRef(false);
  const [scanned, setScanned] = useState<string | null>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const fade = useFadeOut(onClose);
  const camera = useBarcodeCamera(
    videoRef,
    (code) => {
      if (done.current) return;
      done.current = true;
      setScanned(code);
    },
    () => {
      onUnavailable();
      onClose();
    },
  );

  // Hold the ✓ on screen briefly, then release the camera and hand the code back (which closes this).
  useEffect(() => {
    if (!scanned) return;
    const t = setTimeout(() => {
      camera.stop();
      onCodeRef.current(scanned); // the search starts now, under the fading scanner
      fade.start();
    }, LOOKUP_HOLD_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanned]);

  function close() {
    camera.stop();
    fade.start();
  }
  useDialog(rootRef, close, { initialFocus: () => rootRef.current?.querySelector<HTMLElement>("button") });

  const s = camera.state;
  return (
    <div
      className={fade.closing ? "scanner closing" : "scanner"}
      role="dialog"
      aria-modal="true"
      aria-label="Scan a barcode"
      ref={rootRef}
      tabIndex={-1}
    >
      <header className="scanner-head">
        <strong>Scan a barcode</strong>
        <button type="button" onClick={close}>
          Cancel
        </button>
      </header>
      {s.kind === "blocked" || s.kind === "problem" ? (
        <div className="scanner-msg" role="alert">
          <p>
            {s.kind === "blocked"
              ? "Camera blocked. Allow camera access for this site in your browser settings, or type the number instead."
              : s.message}
          </p>
          <button type="button" onClick={close}>
            Close
          </button>
        </div>
      ) : (
        <div className="scanner-view">
          <video ref={videoRef} playsInline muted autoPlay />
          {s.kind === "starting" && <p className="scanner-wait">Starting camera…</p>}
          <ScanFrame last={camera.lastScan} holdMs={LOOKUP_HOLD_MS + 200} />
        </div>
      )}
      <p className="scanner-toast" role="status" aria-live="polite">
        {scanned ? `Scanned ${scanned}, searching…` : "Point the camera at the barcode on the back of the sleeve."}
      </p>
    </div>
  );
}
