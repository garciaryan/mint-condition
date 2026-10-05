"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { shouldRestoreFocus } from "../../../lib/disclosure.ts";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal behaviour: focus moves in on mount, Tab stays inside, Escape closes, and focus returns to
 * `returnTo` (or whatever was focused before) on unmount, unless something outside the dialog took focus meanwhile.
 */
export function useDialog(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  opts: { returnTo?: HTMLElement | null; initialFocus?: () => HTMLElement | null | undefined } = {},
) {
  const { returnTo, initialFocus } = opts;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const root = ref.current;
    const previous = returnTo ?? (document.activeElement as HTMLElement | null);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (initialFocus?.() ?? root)?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === root)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (root && !root.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      const active = document.activeElement;
      const free = shouldRestoreFocus({ onBody: !active || active === document.body, insideDialog: !!root?.contains(active) });
      if (free && previous?.isConnected) previous.focus();
    };
    // Mount-only on purpose; onClose is read through closeRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
