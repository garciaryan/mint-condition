// Whether the barcode camera can be offered, and why not. Client-safe, pure.

export type CameraSupport = { ok: true } | { ok: false; reason: "insecure" | "no-camera"; message: string };

/** `secure` is window.isSecureContext (HTTPS or localhost); browsers hide getUserMedia on plain http. */
export function cameraSupport(env: { secure: boolean; getUserMedia: boolean }): CameraSupport {
  if (env.secure && env.getUserMedia) return { ok: true };
  if (!env.secure) {
    return { ok: false, reason: "insecure", message: "The camera only works over HTTPS. Open the https:// address to scan." };
  }
  return { ok: false, reason: "no-camera", message: "This browser can't use a camera here. Type the number instead." };
}

/** Reads the current browser; the "insecure" answer until mounted, so the server never offers a camera. */
export function browserCameraSupport(): CameraSupport {
  if (typeof window === "undefined") return cameraSupport({ secure: false, getUserMedia: false });
  return cameraSupport({ secure: window.isSecureContext, getUserMedia: !!navigator.mediaDevices?.getUserMedia });
}

/** How long the ✓ stays in a lot scanner's frame after a read (the next read replaces it). */
export const LOT_CUE_MS = 700;
/** How long the one-shot scanner shows the ✓ before closing and searching. */
export const LOOKUP_HOLD_MS = 500;

/** Whether the scan ✓ should still show: from the read until `holdMs` later. */
export function scanCueVisible(lastAt: number | null, now: number, holdMs: number): boolean {
  return lastAt !== null && now >= lastAt && now - lastAt < holdMs;
}
