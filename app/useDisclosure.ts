"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { closeReason } from "../lib/disclosure.ts";

/**
 * Open/closed state for a dropdown: `root` wraps the toggle button and its panel. While open, Escape closes it and
 * returns focus to the button; a tap or focus outside `root` closes it.
 */
export function useDisclosure() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((o) => !o), []);

  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) => t instanceof Node && !!root.current?.contains(t);
    function onKey(e: KeyboardEvent) {
      if (closeReason({ type: "keydown", key: e.key }) !== "escape") return;
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
    }
    function onOutside(e: Event) {
      if (closeReason({ type: e.type as "pointerdown" | "focusin", inside: inside(e.target) })) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("focusin", onOutside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("focusin", onOutside);
    };
  }, [open]);

  return { open, toggle, close, root, button };
}
