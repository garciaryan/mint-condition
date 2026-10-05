// Motion timing shared by CSS and components. Client-safe, pure. Keep SCANNER_EXIT_MS equal to --dur-exit.

/** How long the full-screen scanner takes to fade out before it is removed. */
export const SCANNER_EXIT_MS = 220;

/** The wait before removing a fading element: none when the user asked for reduced motion (no animation runs). */
export function exitMs(reducedMotion: boolean): number {
  return reducedMotion ? 0 : SCANNER_EXIT_MS;
}
