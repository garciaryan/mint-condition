"use client";

import { useRef } from "react";
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
  const camera = useBarcodeCamera(
    videoRef,
    (code) => {
      if (done.current) return;
      done.current = true;
      camera.stop();
      onCode(code);
    },
    () => {
      onUnavailable();
      onClose();
    },
  );

  function close() {
    camera.stop();
    onClose();
  }
  useDialog(rootRef, close, { initialFocus: () => rootRef.current?.querySelector<HTMLElement>("button") });

  const s = camera.state;
  return (
    <div className="scanner" role="dialog" aria-modal="true" aria-label="Scan a barcode" ref={rootRef} tabIndex={-1}>
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
          <div className="scanner-frame" aria-hidden="true" />
        </div>
      )}
      <p className="scanner-toast" role="status" aria-live="polite">
        Point the camera at the barcode on the back of the sleeve.
      </p>
    </div>
  );
}
