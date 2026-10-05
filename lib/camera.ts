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
