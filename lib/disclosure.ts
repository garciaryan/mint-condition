// When an open dropdown (header menu, lot actions) should close. Client-safe, pure.

export type DisclosureEvent =
  | { type: "keydown"; key: string }
  | { type: "pointerdown" | "focusin"; inside: boolean };

/** "escape" also sends focus back to the toggle button; "outside" leaves focus where the user put it. */
export function closeReason(e: DisclosureEvent): "escape" | "outside" | null {
  if (e.type === "keydown") return e.key === "Escape" ? "escape" : null;
  return e.inside ? null : "outside";
}

/** When a dialog closes, give focus back to where it was opened from only if focus is still in the dialog (or lost to
 * the page body); if something else was focused meanwhile, leave it there. */
export function shouldRestoreFocus(active: { onBody: boolean; insideDialog: boolean }): boolean {
  return active.onBody || active.insideDialog;
}
