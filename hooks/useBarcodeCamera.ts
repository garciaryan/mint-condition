"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { createScanFilter } from "@/lib/collection/ui.ts";
import type { LastScan } from "@/app/ScanFrame.tsx";

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

type Detector = { detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>> };
type DetectorCtor = {
  new (opts: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
};

// The browser's own detector when it reads EAN/UPC, else the lazy-loaded barcode-detector ponyfill.
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

export type CameraState =
  | { kind: "starting" }
  | { kind: "ready" }
  | { kind: "blocked" }
  | { kind: "problem"; message: string };

/**
 * Runs the rear camera into `video` and calls `onCode` for each new barcode (repeats of the same code are filtered).
 * `onUnavailable` fires when no detector can load. Call `stop` to release the camera; it also stops on unmount.
 * `lastScan` is the latest accepted read, for the frame's ✓ cue.
 */
export function useBarcodeCamera(
  video: RefObject<HTMLVideoElement | null>,
  onCode: (code: string) => void,
  onUnavailable: () => void,
): { state: CameraState; lastScan: LastScan | null; stop: () => void } {
  const [state, setState] = useState<CameraState>({ kind: "starting" });
  const [lastScan, setLastScan] = useState<LastScan | null>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;
  const onUnavailableRef = useRef(onUnavailable);
  onUnavailableRef.current = onUnavailable;
  const stopRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stream: MediaStream | null = null;
    const accept = createScanFilter();

    function stop() {
      cancelled = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      if (video.current) video.current.srcObject = null;
    }
    stopRef.current = stop;

    async function run() {
      let detector: Detector;
      try {
        detector = await loadDetector();
      } catch {
        if (!cancelled) onUnavailableRef.current();
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
        if ((e as { name?: string } | null)?.name === "NotAllowedError") setState({ kind: "blocked" });
        else setState({ kind: "problem", message: "Couldn't start the camera. Close this and type the number instead." });
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const el = video.current;
      if (!el) return;
      el.srcObject = stream;
      try {
        await el.play();
      } catch {}
      setState({ kind: "ready" });

      let failures = 0;
      async function tick() {
        if (cancelled) return;
        try {
          if (el && el.readyState >= 2) {
            const found = await detector.detect(el);
            failures = 0;
            if (!cancelled && found.length > 0) {
              const code = found[0].rawValue;
              if (accept(code, Date.now())) {
                navigator.vibrate?.(60);
                setLastScan((prev) => ({ code, at: Date.now(), n: (prev?.n ?? 0) + 1 }));
                onCodeRef.current(code);
              }
            }
          }
        } catch {
          // Skip a bad frame, but give up if detection keeps failing (e.g. the WASM never loaded).
          if (++failures >= 8 && !cancelled) {
            stop();
            setState({ kind: "problem", message: "The scanner couldn't start (check your connection). Type the number instead." });
            return;
          }
        }
        if (!cancelled) timer = setTimeout(tick, 250);
      }
      void tick();
    }
    void run();
    return stop;
    // Mount-only; callbacks are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, lastScan, stop: () => stopRef.current() };
}
