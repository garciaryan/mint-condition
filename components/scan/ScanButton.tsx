"use client";

import { useEffect, useId, useState } from "react";
import { browserCameraSupport } from "@/lib/camera.ts";
import type { CameraSupport } from "@/lib/camera.ts";

// Pressable barcode icon that opens a scanner. When the camera can't be used (plain http, no camera, no detector)
// it stays visible and pressing it says why, instead of the button silently disappearing.
export default function ScanButton({ onScan, unavailable }: { onScan: () => void; unavailable?: string | null }) {
  const [support, setSupport] = useState<CameraSupport | null>(null);
  const [explain, setExplain] = useState(false);
  const reasonId = useId();
  useEffect(() => setSupport(browserCameraSupport()), []);

  const reason = unavailable ?? (support && !support.ok ? support.message : null);
  const ready = support?.ok === true && !unavailable;

  return (
    <span className="scan-control">
      <button
        type="button"
        className="scan-button"
        aria-label="Scan a barcode"
        title="Scan a barcode"
        aria-disabled={!ready || undefined}
        aria-describedby={explain && reason ? reasonId : undefined}
        onClick={() => (ready ? onScan() : setExplain(true))}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
          <path
            d="M3 5v3M3 16v3M21 5v3M21 16v3M3 5h3M18 5h3M3 19h3M18 19h3M7 8v8M10 8v8M12.5 8v8M15 8v8M17 8v8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {explain && reason && (
        <span id={reasonId} className="scan-reason small muted" role="status">
          {reason}
        </span>
      )}
    </span>
  );
}
