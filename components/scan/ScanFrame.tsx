"use client";

import { useEffect, useState } from "react";
import { scanCueVisible } from "@/lib/camera.ts";

export type LastScan = { code: string; at: number; n: number };

// The viewfinder frame. After a read it turns cyan, pulses once and shows ✓ with the code for `holdMs`.
export default function ScanFrame({ last, holdMs }: { last: LastScan | null; holdMs: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!last) return;
    setNow(Date.now());
    const t = setTimeout(() => setNow(Date.now()), holdMs);
    return () => clearTimeout(t);
  }, [last, holdMs]);
  const hit = last !== null && scanCueVisible(last.at, now, holdMs);

  return (
    <>
      {/* Keyed by read number so the pulse restarts on every scan. */}
      <div key={hit ? last!.n : "idle"} className={hit ? "scanner-frame hit" : "scanner-frame"} aria-hidden="true" />
      {hit && (
        <div className="scan-cue" aria-hidden="true">
          <span className="scan-cue-check">✓</span>
          <span className="scan-cue-code">{last!.code}</span>
        </div>
      )}
    </>
  );
}
